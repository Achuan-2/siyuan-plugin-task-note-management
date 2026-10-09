const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const tls = require('node:tls');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');

// 本地 TLS SMTP 验证真实打包产物，不使用用户邮箱或外部邮件服务。
test('桌面 SMTP 构建产物通过 SSL/TLS 和 STARTTLS 发送完整正文，登录失败和取消发送均返回安全错误', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-note-smtp-test-'));
    const certFile = path.join(temp, 'localhost.pem'), keyFile = path.join(temp, 'localhost.key');
    const gitOpenSSL = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
    const openssl = process.env.OPENSSL_PATH || (fs.existsSync(gitOpenSSL) ? gitOpenSSL : 'openssl');
    const sockets = new Set(), messages = [];
    let server, starttlsServer, authFails = false, silent = false, authenticated = false;
    try {
        execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
            '-keyout', keyFile, '-out', certFile], { stdio: 'ignore' });
        const credentials = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
        const attach = (socket, greet = true) => {
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
            socket.on('error', () => {});
            if (silent) return;
            if (greet) socket.write('220 localhost SMTP ready\r\n');
            let buffer = '', data = null;
            const onData = chunk => {
                buffer += chunk.toString();
                let end;
                while ((end = buffer.indexOf('\r\n')) >= 0) {
                    const line = buffer.slice(0, end);
                    buffer = buffer.slice(end + 2);
                    if (data !== null) {
                        if (line === '.') { messages.push(data.join('\n')); data = null; socket.write('250 Accepted\r\n'); }
                        else data.push(line);
                    } else if (line.startsWith('EHLO')) socket.write(socket.encrypted
                        ? '250-localhost\r\n250 AUTH PLAIN\r\n' : '250-localhost\r\n250 STARTTLS\r\n');
                    else if (line === 'STARTTLS') {
                        socket.write('220 Ready for TLS\r\n');
                        socket.removeListener('data', onData);
                        attach(new tls.TLSSocket(socket, { isServer: true, secureContext: tls.createSecureContext(credentials) }), false);
                    }
                    else if (line.startsWith('AUTH PLAIN ')) {
                        assert.equal(socket.encrypted, true, 'authentication must happen after TLS');
                        authenticated = Buffer.from(line.slice(11), 'base64').toString().endsWith('\0sender@example.com\0test-password');
                        socket.write(authFails ? '535 Login rejected: private account details\r\n' : '235 Authenticated\r\n');
                    } else if (line === 'DATA') { data = []; socket.write('354 Send message\r\n'); }
                    else if (line === 'QUIT') socket.end('221 Bye\r\n');
                    else socket.write('250 OK\r\n');
                }
            };
            socket.on('data', onData);
        };
        server = tls.createServer(credentials, socket => attach(socket));
        starttlsServer = net.createServer(socket => attach(socket));
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        await new Promise(resolve => starttlsServer.listen(0, '127.0.0.1', resolve));
        const settings = {
            reminderEmailTransport: 'smtp', reminderEmailSmtpHost: '127.0.0.1', reminderEmailSmtpPort: server.address().port,
            reminderEmailSmtpSecurity: 'tls', reminderEmailSmtpPassword: 'test-password',
            reminderEmailFrom: 'sender@example.com', reminderEmailTo: 'recipient@example.com'
        };
        const script = `const { DesktopSmtpSender } = require(process.argv[1]);
            const sender = new DesktopSmtpSender();
            const body = Array.from({length:12}, (_, i) => 'Task ' + String(i + 1).padStart(2, '0')).join('\\n');
            const pending = sender.send(JSON.parse(process.env.SMTP_TEST_SETTINGS), 'Daily tasks (12)', body);
            if (process.env.SMTP_TEST_CANCEL) setTimeout(() => sender.close(), 100);
            pending.then(() => process.stdout.write('sent'), error => { process.stderr.write(error.message); process.exitCode = 1; });`;
        const run = cancel => new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['-e', script, path.resolve(__dirname, '../dist/desktop-smtp.cjs')], {
                env: { ...process.env, NODE_EXTRA_CA_CERTS: certFile, SMTP_TEST_SETTINGS: JSON.stringify(settings),
                    SMTP_TEST_CANCEL: cancel ? '1' : '' }, windowsHide: true
            });
            let stdout = '', stderr = '';
            child.stdout.on('data', data => { stdout += data; });
            child.stderr.on('data', data => { stderr += data; });
            child.on('error', reject);
            child.on('close', code => resolve({ code, stdout, stderr }));
        });
        const success = await run(false);
        assert.equal(success.code, 0, success.stderr);
        assert.equal(authenticated, true);
        assert.equal(messages.length, 1);
        assert.match(messages[0], /Task 12/);
        assert.equal(messages[0].split('\n').filter(line => /^Task \d{2}$/.test(line)).length, 12);
        Object.assign(settings, { reminderEmailSmtpPort: starttlsServer.address().port, reminderEmailSmtpSecurity: 'starttls' });
        const upgraded = await run(false);
        assert.equal(upgraded.code, 0, upgraded.stderr);
        assert.equal(messages.length, 2);
        assert.match(messages[1], /Task 12/);
        Object.assign(settings, { reminderEmailSmtpPort: server.address().port, reminderEmailSmtpSecurity: 'tls' });
        authFails = true;
        const failure = await run(false);
        assert.equal(failure.code, 1);
        assert.equal(failure.stderr, 'emailSmtpAuthFailed');
        silent = true;
        const cancelled = await run(true);
        assert.equal(cancelled.code, 1);
        assert.equal(cancelled.stderr, 'emailSmtpCancelled');
    } finally {
        for (const socket of sockets) socket.destroy();
        if (server) await new Promise(resolve => server.close(resolve));
        if (starttlsServer) await new Promise(resolve => starttlsServer.close(resolve));
        const resolvedTemp = path.resolve(temp), tempRoot = path.resolve(os.tmpdir()) + path.sep;
        if (!resolvedTemp.startsWith(tempRoot)) throw new Error('Test temporary directory escaped temp root');
        fs.rmSync(resolvedTemp, { recursive: true, force: true });
    }
});
