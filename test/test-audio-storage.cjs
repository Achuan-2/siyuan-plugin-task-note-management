const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(
    path.join(__dirname, '../src/utils/audioUtils.ts'), 'utf8'
), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const audioPath = 'data/storage/petal/siyuan-plugin-task-note-management/audios/kf.mp3';

function fixture() {
    const stored = new Map();
    const uploads = [];
    const reads = [];
    const urls = [];
    const state = { response: { code: 0, data: null }, readError: null, readBlob: undefined };
    const dependencies = {
        siyuan: {
            async fetchSyncPost(endpoint, form) {
                uploads.push({ endpoint, form });
                if (state.response?.code === 0) stored.set(form.get('path'), form.get('file'));
                return state.response;
            }
        },
        '../api': {
            async getFileBlob(path) {
                reads.push(path);
                if (state.readError) throw state.readError;
                return state.readBlob !== undefined ? state.readBlob : stored.get(path) || null;
            }
        }
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'Blob', 'FormData', 'URL', 'window', 'console', compiled)(
        name => dependencies[name], module, module.exports, Blob, FormData,
        { createObjectURL: blob => { urls.push(blob); return `blob:test-${urls.length}`; } },
        { location: { protocol: 'http:', host: '127.0.0.1:6806' } },
        { warn() {} }
    );
    return { ...module.exports, stored, uploads, reads, urls, state };
}

function file(contents = 'MP3 bytes') {
    // 模拟 Electron 的磁盘 File：只有读取快照才能得到内容。
    return { name: 'kf.mp3', type: 'audio/mpeg', arrayBuffer: async () => new TextEncoder().encode(contents).buffer };
}

test('上传读取内容快照，检查内核返回码和回读内容后缓存可播放 URL', async () => {
    const env = fixture();
    assert.equal(await env.storeAudioFile(file()), `/${audioPath}`);
    assert.equal(env.uploads[0].endpoint, '/api/file/putFile');
    assert.equal(env.uploads[0].form.get('isDir'), 'false');
    assert.equal(env.uploads[0].form.get('file').name, 'kf.mp3');
    assert.equal(await env.uploads[0].form.get('file').text(), 'MP3 bytes');
    assert.deepEqual(env.reads, [audioPath]);
    assert.equal(await env.resolveAudioPath(audioPath), 'blob:test-1');
    assert.equal(await env.resolveAudioPath(`/${audioPath}`), 'blob:test-1');
    assert.equal(env.reads.length, 1);
});

for (const response of [{ code: -1, msg: 'write denied' }, undefined]) {
    test(`内核拒绝上传或没有响应时不得返回可保存路径：${response?.code}`, async () => {
        const env = fixture();
        env.state.response = response;
        await assert.rejects(env.storeAudioFile(file()), /write denied|Audio upload failed/);
        assert.equal(env.reads.length, 0);
        assert.equal(env.urls.length, 0);
    });
}

test('源文件不可读或为空时不发起上传', async () => {
    const env = fixture();
    await assert.rejects(env.storeAudioFile({ ...file(), arrayBuffer: async () => { throw new Error('file unavailable'); } }), /file unavailable/);
    await assert.rejects(env.storeAudioFile(file('')), /empty/);
    assert.equal(env.uploads.length, 0);
});

for (const [name, blob] of [
    ['文件不存在', null],
    ['空文件', new Blob([])],
    ['JSON 错误响应', new Blob(['{"code":404}'], { type: 'application/json' })],
    ['HTML 错误页', new Blob(['<html>error</html>'], { type: 'text/html' })]
]) {
    test(`读取${name}时不能缓存错误或退回 storage 静态路径`, async () => {
        const env = fixture();
        env.state.readBlob = blob;
        await assert.rejects(env.resolveAudioPath(`/${audioPath}`), /Cannot read stored audio/);
        assert.equal(env.urls.length, 0);
        env.state.readBlob = new Blob(['valid'], { type: 'audio/mpeg' });
        assert.equal(await env.resolveAudioPath(audioPath), 'blob:test-1');
        assert.equal(env.reads.length, 2);
    });
}

test('Failed to fetch 向调用方报告，网络恢复后允许重新读取', async () => {
    const env = fixture();
    env.state.readError = new TypeError('Failed to fetch');
    await assert.rejects(env.resolveAudioPath(audioPath), /Failed to fetch/);
    env.state.readError = null;
    env.stored.set(audioPath, new Blob(['valid']));
    assert.equal(await env.resolveAudioPath(audioPath), 'blob:test-1');
});

test('同名覆盖更新缓存；回读失败不会保留旧声音或假报上传成功', async () => {
    const env = fixture();
    await env.storeAudioFile(file('first'));
    await env.storeAudioFile(file('second'));
    assert.equal(await env.resolveAudioPath(audioPath), 'blob:test-2');
    assert.equal(await env.urls[1].text(), 'second');
    env.state.readError = new TypeError('Failed to fetch');
    await assert.rejects(env.storeAudioFile(file('third')), /Failed to fetch/);
    await assert.rejects(env.resolveAudioPath(audioPath), /Failed to fetch/);
    env.state.readError = null;
    assert.equal(await env.resolveAudioPath(audioPath), 'blob:test-3');
    assert.equal(await env.urls[2].text(), 'third');
});

test('回读内容长度不一致时拒绝保存设置；通用二进制 MIME 的有效文件仍可上传', async () => {
    const env = fixture();
    env.state.readBlob = new Blob(['truncated'], { type: 'application/octet-stream' });
    await assert.rejects(env.storeAudioFile(file('longer audio content')), /size mismatch/);
    assert.equal(env.urls.length, 0);
    env.state.readBlob = new Blob(['MP3 bytes'], { type: 'application/octet-stream' });
    assert.equal(await env.storeAudioFile(file()), `/${audioPath}`);
});

test('内置声音与外部 URL 保持原有解析规则', async () => {
    const env = fixture();
    assert.equal(await env.resolveAudioPath('/plugins/example/audios/builtin.mp3'), 'http://127.0.0.1:6806/plugins/example/audios/builtin.mp3');
    assert.equal(await env.resolveAudioPath('https://example.com/audio.mp3'), 'https://example.com/audio.mp3');
    assert.equal(await env.resolveAudioPath(''), '');
    assert.equal(env.reads.length, 0);
});
