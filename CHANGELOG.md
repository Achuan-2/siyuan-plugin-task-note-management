## v4.2.0 / 20251224

- 🎨 支持绑定块新建标题，绑定块支持搜索文档和标题块
- 🎨 设置添加静默上传ics文件设置
- 🎨 优化ics上传逻辑：检测事件有没有新生成（reminder.json时间是否新于上一次同步时间）。没有新生成则不上传（但还要更新上一次同步时间）
- 🎨 支持设置绑定标题的完成状态样式
- 🎨 quickreminder 把绑定块id清空保存要删除docid
- 🎨 quickreminder 如果绑定块粘贴块引用时，标题输入框为空，需要自动获取块标题到标题

## v4.1.1 / 20251223
- 🎨 优化日历视图列表交互：
  - 改进switchViewType，目前周视图和日视图的switchViewType是分别记忆的，不要分别记忆，switchViewType直接控制周视图和日视图显示风格
  - 优化switchViewType按钮，目前如果窄的话，switchViewType label会变成一列显示，导致撑高

## v4.1.0 / 20251223
- 🎨 日历视图增加更多视图 [#223](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/223)

## v4.0.5 / 20251223

- 🎨 设置插件最低思源版本为3.5.1
- 🎨 支持直接上传ics文件到思源服务器，限制思源版本v3.5.1  [#219](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/219)

## v4.0.4 / 20251223
- 🎨 任务管理侧栏的任务可以直接拖动到日历，调整任务时间 [#218](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/218)
- 🎨 任务管理侧栏添加设置，支持设置是否显示已完成的子任务 [#224](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/224)


## v4.0.3 / 20251223

- 🎨 日历视图优化：
  - 修复日历拖动重复渲染问题
  - 全天事件拖动为定时事件，fullcalendar是有默认时间跨度的，1小时，而目前把全天事件拖动到某个时间点，没有给这个事件设置结束时间，导致刷新之后事件变短
- 🎨 ics订阅刷新优化：不需要每次启动都拉取，根据lastSync来定时拉取

## v4.0.0 / 20251223
- ✨ 支持ics文件导入
- ✨ 支持订阅ics链接

## v3.9.3 / 20251223
- 🎨 mac系统表情文件无法正确加载，改为相对路径 ([#214](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/214))，感谢[QYLexpired](https://github.com/QYLexpired)贡献
- 🎨 增加一天起始时间的设置，增加任务时间统计功能，增加日历快捷键 ([#221](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/221))，感谢[ebAobS](https://github.com/ebAobS)贡献

## v3.9.2 / 20251223
- 🎨 改进S3设置：添加自定义域名，使用思源S3设置，还可以设置bucket和S3 存储路径

## v3.9.0 / 20251222
- ✨ 支持使用S3来同步ICS文件

## v3.8.0 / 20251215
- 🎨 支持使用思源API
- 🎨 支持设置日历起始时间
## v3.7.0 / 20251215
- 🎨 支持生成ics文件

## v3.6.2 / 20251215

- 🐛 修复当天时间段编辑丢失时间的问题
- 🎨 支持项目管理绑定块更换 #208

## v3.6.1 / 20251214

- 🐛 项目看板任务数量统计错误 #207
- 🎨 任务状态看板不需要显示status-stable-group-header
- 🎨 优化projectdialog样式


## v3.6.0 / 20251214

- 🎨 项目看板添加项目专属标签功能
- 🎨 项目编辑对话框支持编辑项目颜色 #202
- 🎨 项目看板新建的任务默认在优先级排序下默认放在同一优先级的最后
- 🎨 删除项目，是否删除项目的所有任务 #195
- 🎨 习惯打卡的选项可以标记哪个打卡项不认为是成功打卡 #199
- 🎨 编辑已完成任务，完成时间可以修改 #194
- 🎨 任务编辑支持查看父任务 #198
- 🎨 任务侧栏子任务右键菜单添加解除父子任务关系按钮 #200
- 🎨 任务侧栏今日任务如果把子任务拖拽出来，解除父子任务关系，要添加今日日期，否则就找不到了 #201
- 🎨 日历视图支持ctrl+滚轮放大缩小时间间隔
- 🎨 任务管理拖拽任务排序支持跨优先级排序，自动更改优先级 #204
- 🎨 项目管理拖拽项目排序支持跨优先级排序，自动更改优先级
- 🎨 习惯拖拽排序支持跨优先级排序，自动更改优先级 #205
- 🐛 项目面板编辑任务会错误触发两次更新
- 🐛 单独修改日期的重复实例没有在日历视图日视图和周视图显示（月视图可以正常显示）
- 🐛 正计时如果不到一个番茄钟的时间无法记录 #197

## v3.5.0 / 20251206

- ✨项目自定义分组支持绑定块，点击跳转
- 🎨任务提醒：重复事件，编辑实例没有保存和提醒 [#189](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/189)
- 🎨习惯支持优先级排序
- 🎨习惯统计的月度打卡视图悬浮emoji支持显示备注 [#188](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/188)
- 🎨习惯统计的月度打卡视图支持单击编辑，添加/修改当天的习惯
- 🎨历史打卡，每一天的打卡按时间排序展示
- 🎨今日任务统计数量优化
- 🎨统计打卡天数、月视图打卡完成，需要根据每个习惯的打卡目标，如果打卡次数没有达标，也认为没有完成打卡
- 🎨 优化打包脚本
- 🐛 粘贴创建任务没有添加块书签
- 🐛 日期识别错误识别为农历对应日期 [#191](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/191)
- 🐛日历视图根据项目上色的时候，修改项目上色，日历无法更新项目颜色 [#193](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/193)
- 🐛项目管理计数：在没有项目的情况下提示有1个项目 [#190](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/190)

## v3.4.0 /20251203

- 🚀日历视图加载性能优化 [#170](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/170)
- 🎨日历视图顶栏按钮优化 [#181](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/181)
- 🎨习惯统计优化年度打卡视图 [#175](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/175)
- 🎨改进习惯的时间提醒编辑：编辑不用处理过去的提醒数据
- 🎨编辑习惯打卡支持编辑打卡时间点
- 🎨习惯打卡的查看统计图标设置为iconSparkles
- 🎨习惯打卡打卡状态分布统计根据百分比填充绿色 [#180](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/180)
- 🎨习惯日历统计界面优化 [#185](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/185)
- 🎨番茄钟专注趋势：专注为0m，不应该显示高度 [#179](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/179)
- ⚙设置添加一个打开插件数据文件夹按钮和删除文件夹按钮
- ⚙数据保存优化，精简保存的文件 [#107](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/107)
在index.js用常量的方式罗列所有要保存的数据文件名
- 🎨状态管理、分类图标使用emoji picker [#182](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/182)
- 🎨优化任务提醒时间编辑和新增
- 🎨batchReminderDialog的编辑调用quickerReminderDialog [#183](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/183)
- 🔥编辑任务删除标题blur自动识别日期功能
- 🎨编辑任务不设置具体时间取消勾选需要保留原来的日期 [#184](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/184)

## v3.3.8 / 20251201

- 🐛创建提醒时，没有给块成功添加书签⏰ [#171](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/171)

## v3.3.7 / 20251201

- 🐛 打包缺失i18n文件 [#169](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/169)
- 🎨随机提示音系统通知自动关闭 [#163](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/163)
- 🎨 习惯提醒支持设置多个时间提醒 [#161](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/161)
- 🎨任务支持设置多个提醒时间 [#162](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/162)
- 🎨习惯统计优化 [#158](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/158)


## v3.3.6 / 20251130

- 🎨习惯侧栏改进：顶部需要sticky [#156](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/156)
- 🎨习惯统计优化 [#158](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/158)
- 🎨历史打卡需要一行一个展示 [#155](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/155)
- 🎨番茄钟记录支持删除 [#159](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/159)
- 🎨番茄钟计数优化：显示总番茄数和今日番茄数 [#119](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/119)
- 🎨任务侧栏渲染bug：展开子任务不显示子任务番茄数，目前需要在展开状态下刷新才显示  [#157](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/157)
- 🎨随机提示音提醒优化 [#154](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/154)
- 🎨如果开启了随机提示音，界面要出现一个骰子🎲图标，在番茄计数右边添加，每次随机提示音休息响起都+1 [#153](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/153)

## v3.3.5 /20251130
- 🎨习惯打卡面板改进
  - 添加打卡按钮
  - 绑定块样式改进
- 🎨项目侧栏：支持单击项目打开项目看板 [#149](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/149)
- 🎨设置里修改番茄钟时间和随机提示音需要更新当前番茄钟 [#147](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/147)
- 🎨 随机提示音最大值默认值改为5分钟


## v3.3.4 / 20251129

- 🎨 设置新增侧栏设置Tab，支持开关任务管理、项目管理、习惯管理侧栏 [#145](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/145)
- 🎨 全天提醒的时间设置优化，支持设置具体时间点，比如09:00  [#144](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/144)
- 🎨 尝试修复「提示音不断重复」 [#133](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/133)
- 🐛 四象限面板勾选任务不会自动移除 [#142](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/142)
- 🐛 随机提示音失效尝试修复 [#30](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/30)
- 🐛 修复习惯提醒消息格式

## v3.3.3 / 20251128

- ✨ 新增习惯打卡侧栏
- ✨ 新增提醒时间设置，可提前提醒任务，而不改变任务时间
- 🎨 日历重复任务拖动优化
- 🎨 日历视图支持筛选完成状态：未完成、已完成、全部
- 🎨 任务管理和项目管理分类筛选优化：支持多选
- 🎨 重复任务需要设置时间才能创建
- 🎨 智能识别日期优化：农历识别，支持“农历7月13”“农历七月13”识别
- ♻️ 重构代码：合并reminderDialog和reminderEditDialog到quickReminederDialog代码

## v3.3.2 / 20251123
- 🎨 重启思源，自定义Tab依然可以显示

## v3.3.1 / 20251123
- 🎨 在发布模式下，用浏览器方式打开思源笔记，应隐藏并禁用 [#128](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/128)
- 🎨 优化addBlockProjectButtonsToProtyle函数 [#130](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/130)

## v3.3 / 20251121

- ✨ 日历视图 周视图支持设置一周开始 [#126](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/126)
- ✨ 绑定块有项目在块属性显示按钮 [#120](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/120)
- 🎨 新建快速提醒在绑定块右边添加一个粘贴块引用/块链接按钮，可以粘贴块引用，获取标题和块id [#123](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/123)
- 🎨 日历显示子任务优化：悬浮需要显示父任务 [#118](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/118)
- 🎨 项目自定义分组看板优化下父子任务成情况：完成的子任务也要显示（参考任务状态看板） [#124](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/124)
- 🐛项目排序kanban-sort-menu样式错乱 [#122](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/122)

## v3.2 / 20251115

- ✨项目搜索优化：支持搜索项目分类、自定义分组搜索项目 [#117](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/117)
- ✨ feat(任务管理): 新增未来任务过滤项,方便修改管理7天以后的未来任务 ([#116](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/116))（感谢[@fetasty](https://github.com/fetasty)贡献）


## v3.1 / 20251113

- 🎨 日历视图筛选分类，点击创建任务，默认填充对应分类
- 🎨 新建子任务不填充时间段信息

## v3.0 / 20251112

- ✨ 日历视图添加筛选只显示某个项目功能 [#114](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/114)
- ✨ 新建子任务支持设置具体时间 [#108](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/108)
- 🐛 绑定块创建文档失败 [#113](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/113)
尝试修复
- 🐛 四象限已过期N天标签数值计算错误 [#111](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/111)




## v2.4 / 20251101

- 🎨项目看板：新建任务记住上一次的任务状态选择 [#103](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/103)
- 🎨 项目看板：任务状态看板的刷新优化，刷新不跳动 [#100](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/100)
- 🎨任务管理侧栏的刷新优化，刷新不跳动 [#101](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/101)
- 🎨重复事件优化

  - 只显示实例
  - 点击完成默认是完成该实例，而不是原始事件，这样下一个重复实例还能继续进行
  - 重复实例也需要像普通任务一样显示所属项目
  - 重复实例支持单独番茄钟计数

  🎨四象限优化

  - 需要将今天或过去的任务作为进行中任务

## v2.3 / 20251026
- 💄 style(样式): 移除提醒面板高度限制
  - 调整提醒面板样式，移除高度设置
  - 优化悬浮窗口中的提醒面板样式
- ♻️ refactor(项目看板): 默认折叠所有父任务
- ✨ 项目自定义看板的分组支持显示进行中、短期、长期、已完成任务 [#98](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/98)
- 🎨 番茄钟显示优化：直接显示番茄数量🍅 具体数量 [#99](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/99)
- 💄 番茄钟默认窗口不隐藏顶部菜单 [#97](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/97)
## v2.2.1 / 20251023
- 🐛 项目看板自定义分组-修改项目内容后保存保存会丢失分组信息 [#95](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/95)

## v2.2 / 20251023
- ✨ 项目看板支持自定义分组 [#85](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/85)

## v2.1 / 20251022

- ✨ 每日通知支持关闭 [#88](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/88)
- 🎨 新建任务、修改任务允许不设置日期 [#83](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/83)
- 🎨 项目看板优化：进行中判断优化 [#89](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/89)

  - 如果未完成的任务设置了日期，哪怕没有设置为进行中，根据startDate日期为今天或者是未来需要放入进行中列
- 🎨 项目看板新建的任务默认使用项目所属的标签 [#84](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/84)
- 🎨 项目看板任务倒数日显示优化 [#81](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/81)

  1. 如果任务为时间段（同时有startDate和endDate）应该根据endDate显示倒数日，而不是startDate和endDate都显示倒数日，导致错误显示两个倒数日，只显示一个倒数日即可
  2. 明天任务倒数日应该显示为剩1天开始而不是“剩明天开始”
  3. 过去已完成的任务，就不用显示日期倒数日了
- 🎨 重复事件的编辑实例，备注需要复用原始事件的备注 [#78](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/78)
- 🎨 任务管理侧栏添加「昨日已完成」筛选项 [#82](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/82)
- 📝 README补充 #87

  - 知行合一：知识和任务不应该分开
  - 滴答清单更偏向任务管理，管理固定日期的行程，但对于长期项目管理、目标管理的功能不足
  - 任务管理的几个状态

    - 想到什么创建什么任务
    - 专注重要的任务
    - 管理项目，看重项目的整体进展，延迟满足
  - 推荐的使用方式：新建一个项目，设置为项目，添加任务，任务进行中和完成后的笔记放在项目笔记里

## v2.0 / 20251017

- 🎨 四象限面板和项目看板的重复事件显示优化 [#70](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/70)

  1. 重复事件的startdate日期为未来日期存在问题：如果设置StartDate为20251101开始（今天是20251015，也就是设置为未来日期），每月1号的重复事件，任务会出现两个20251101和20251201，startDate为20251001的每月重复任务就不会有这个问题，需要修复
  2. 重复事件的整体逻辑需要修改，只显示实例，不显示原始任务非农历周期任务也不显示原始任务，只显示实例
- 🎨 新建任务、修改任务的设置农历重复优化 [#76](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/76)

  - 点击设置重复弹窗，农历日期（农历日和农历月）都需要重新计算，以防修改startDate之后，农历日期没有变化
- 🎨 任务管理面板拖动排序优化 [#73](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/73)
- ♻️ refactor(日期输入): 为日期输入框添加最大日期限制

  - 在多个日期输入框中设置最大日期为 9999-12-31，确保用户输入的日期不会超出合理范围
  - 输入四位数年份，自动跳到月份，更方便输入日期
- ♻️ refactor(日期验证): 移除立即验证逻辑，改为保存时验证

  - 调整开始日期和结束日期的验证逻辑
  - 优化日期比较方式，确保结束日期不早于开始日期
- 🎨 四象限面板优化：子任务不显示看板状态
- 🎨 四象限面板优化：不渲染已完成的子任务
- 🎨 四象限面板的右键菜单调整
- 🎨 粘贴新建子任务，每个子任务如果没指定优先级，要继承父任务的优先级 [#74](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/74)
- 💄 项目看板和四象限看板日期显示优化

  1. 如果普通任务和重复实例的日期不在今年，需要显示年份
  2. 如果日期已过期，需要显示已过期x天（如果任务只有startDate，根据startDate计算，如果任务有startDate和endDate，根据endDate计算）
- 💄 style(ReminderPanel): 更新提醒面板时间图标

  - 将排序菜单中的时间图标更改为日历图标
  - 更新提醒项中的时间显示图标为日历图标
## v1.9 / 20251015
- 💄 优化日期自动识别对话框样式、
- ✨ 任务管理面板：添加拖拽功能以支持任务排序和父子关系设置
- ✨ 新建任务、修改任务、四象限面板支持设置任务状态：进行中、短期待办、长期待办
- ✨ 四象限面板：优化紧急性判断
  1. 如果任务有startDate和endDate，应该要显示任务的日期跨度
  2. 如果任务有startDate和endDate，判断紧急应该用endDate
  3.过期任务判断为紧急

## v1.8 /20251015

- 🐛单个任务消息提醒时间不受制全天事项通知，设置几点就几点通知
- 🎨全天事项通知启用任务提醒系统弹窗，也要在思源内部通知
- 🎨快速提醒控制台不警告`提醒项缺少必要属性`

## v1.7 / 20251012
- ✨ 项目看板优化 [#68](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/68)
- ✨打开项目面板默认显示全部项目


## v1.6 / 20251012

- ✨ 任务支持农历重复设置
- ✨ 任务日期识别支持农历日期，如农历七月十三
- ✨ feat(四象限看板): 添加任务看板状态筛选功能，只显示doing的任务
- ✨ feat(四象限看板): 支持设置任务doing和todo
- ✨ feat(项目看板): 项目看板的任务添加支持重复设置

  1. 项目看板的新建任务改为调用quickReminderDialog，模块化，减少重复代码
  2. 需要支持项目看板的新建任务的特殊显示：不显示项目设置，默认为当前项目，显示短期任务和长期任务选择

## v1.5 / 20251011
- 💄番茄钟独立窗口优化
  1.移除数据统计折叠按钮
  2. 继续和暂停按钮的间距需要自适应调大，以适应窗口，避免重叠
- 🐛 fix(番茄钟): 优化部分情况无法打开新窗口问题

## v1.4 / 20251011

- ✨ 番茄钟实现多窗口通信
- ✨ 任务管理面板：「今日已完成」刷新优化  [#53](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/53)
- ✨ 项目看板：把todo拆解为long term和short term [#56](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/56)
- 💄 style(任务标题输入框): 优化项目看板新增任务和任务面板新增子任务标题输入框样式，将任务标题输入框宽度设置为100%
- 💄 移动端支持打开四象限 #55
- 💄 移动端设置面板左边栏无显示 [#55](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/55)
- 🐛 番茄计时最小化异常 [#59](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/59)

## v1.3 / 20251003

- ✨番茄钟支持新窗口打开
- ✨番茄钟按钮样式优化


## v1.2.1 / 20251001

- 🐛父任务设置项目，现有的子任务也要设置同样项目[#50](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/50)
- ✨ 新建快速提醒绑定块优化：支持输入绑定块ID和新建文档
- ✨手机端支持查看项目看板

  - 参考openCalendarTab，新建openProjectKanbanTab函数
  - 替换所有文件使用openTab打开项目看板的代码
- ✨项目看板支持显示周期事件
- 🐛在任务看板新建任务，在修改弹窗设置绑定块id，在项目看板没有显示任务有绑定块

## v1.2 / 20251001

- 💄设置新增一个Tab，数据存放位置，告知数据存放在data/storage/petal/siyuan-plugin-task-note-management，并添加一个按钮，点击可以打开文件夹
- 💄弹窗提示优化

  - 番茄钟系统弹窗如果开启，不用显示思源笔记弹窗
  - 任务提醒系统弹窗如果开启，不用显示思源笔记消息弹窗
- 🐛番茄钟声音优化：尝试修复有时候随机提示音偶尔没声音的问题

## v1.1 / 20251001 日历视图显示优化

- 💄日历视图：非全天事件没有border，要与全天事件区别开
- 💄日历视图：绑定块样式优化

  - 有绑定块的事件，右上角带一个小的链接🔗图标
  - 移除未绑定块事项的颜色透明度差异。
- 💄日历视图: 优化已完成任务的文本颜色

  - 改为透明白色，提升在不同状态下的可读性
- 💄日历视图:  任务分类显示优化

  - 任务的分类之前是直接加到fc-event-title，现在把分类的emoji也参考链接图标，放在右上角，放在链接图标的左侧


## v1.0.0 / 20250930

- ✨ 任务管理面板刷新优化 [#42](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/42)

  - 完成的任务直接隐藏
  - 删除任务不用刷新全局，只移除当前任务DOM
  - 添加分类不用刷新全局，只更新当前任务DOM
  - 添加优先级不用刷新，只更新当前任务DOM
  - 把刷新移出更多菜单，在番茄钟按钮右侧
  - 拖拽排序不要刷新全局，只更新受影响的DOM排序
  - 新建子任务、批量粘贴子任务不刷新全局
- 💄任务管理面板样式优化：绑定块和非绑定块样式优化 [#43](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/43)

  - `reminder-item__title`如果没有绑定块，cursor不应该显示为pointer，也不应该有hover下划线样式
  - 如果绑定块是文档，不要显示所属文档名块链接，给`reminder-item__title`添加块链接
- ✨全局番茄管理器 [#45](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/45)

  - 日历面板、任务面板、项目看板、四象限面板打开同一个番茄钟，不再独立打开各自番茄钟
- ✨项目管理支持搜索 [#46](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/46)
- ✨“任务笔记管理”图标下标数字显示优化 [#31](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/31)

  - 考虑周期事件
- ✨增加快捷键配置 [#12](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/12)

  - 设置当前文档为任务
  - 设置当前块为任务
  - 设置项目管理
- ✨绑定块支持解析块引用格式 [#48](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/48)

## v0.9.0 / 20250920
- 🐛 fix(任务管理面板): quick project 的任务从任务面板上”打开项目看板“，提示”加载项目失败“ [#32](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/32)
- 🐛 fix(任务管理面板): 任务分类显示丢失
- ✨ feat(项目面板): 添加双击打开项目看板支持
- ✨ feat(项目面板): quick project support open project kanbanTab
- ✨ feat(批量提醒对话框): 添加批量设置项目功能
- 💄 style(日历视图): 日历视图中，已完成任务的颜色不变灰色，保持原有颜色 [#39](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/39)

## v0.8.0 / 20250919

- 日历视图新增任务摘要及复制功能 #34，感谢 @MoonBottle 贡献

## v0.7.8/20250829

- ✨任务管理面板：优化今日已完成和全部已完成的排序问题：默认按照完成时间降序来展示，不受排序方式影响
- ✨任务管理面板：支持分页展示，每页展示30个任务
- ✨任务管理面板：父任务默认折叠子任务展示
- ✨任务管理面板：任务右键菜单的新建子任务下面添加一个粘贴新建子任务
- ✨项目管理面板：添加项目进度条，进度条等于done/（todo+doing+done），如果todo、doing、done都是0，则进度为0%
- ✨项目看板：每个状态添加分页机制，每页最多30个任务
- ✨项目看板：任务右键菜单的新建子任务下面添加一个粘贴新建子任务
- ✨项目看板：删除父任务优化：考虑多级子任务

## v0.7.7 / 20250828
- 🐛 任务管理面板添加番茄钟计数显示功能

## v0.7.6 / 20250828
- ✨项目看板面板支持粘贴创建任务支持任务列表格式
- ✨项目管理面板的全部项目按项目状态进行分组（忽略已归档项目）

## v0.7.5 / 20250827

- ✨项目看板有子任务的可以支持显示进度条
- ✨项目看板新建任务应该放在最下面
- ✨项目看板绑定到块支持创建文档
- ✨项目看板：支持直接拖动任务到一个父任务的子任务上下，使其成为子任务，并插入到选择的位置，目前需要先设置为子任务，才能完成子任务的排序，太麻烦了
- ✨项目看板父任务右键菜单添加复制子任务为列表
- ✨项目管理面板显示当前项目有几个任务在doing，几个在todo，已完成多少个（只计算父任务个数）
- ✨有子任务的可以支持显示进度条
- ✨四象限面板参考任务管理面板，子任务完成也要显示出来，不隐藏
- ✨任务管理面板已完成的任务添加透明度
- ✨任务管理面板优化：完成任务不直接刷新面板，这会导致跳动，只更新当前任务和父任务显示
- ✨文档创建任务，标题是第一个块内容， 需要修复为文档标题


## v0.7.4 / 2025-08-24
- ✨ feat(i18n): 将“设置时间提醒”修改为“设置为任务”
- 🔥 移除块彩蛋的「添加到项目」按钮，直接用添加任务就可以设置项目了
- 🔥 移除文档面包屑添加到「查看提醒」按钮的创建



## v0.7.3 / 2025-08-24

- ✨任务管理面板完善

  - 支持父子任务显示

    - 父子任务显示规则

      - ✅ 如果父任务满足筛选（例如父任务是“今天”），所有子任务都会一起显示（并可折叠/展开）。
      - ✅ 如果是子任务满足筛选（例如某子任务是“今天”），则把它的所有祖先（父、祖父等）都显示出来（计算父任务不符合筛选条件如“今天”，也要显示），根据 parentId 获取所有祖先节点，最后把所有符合的子任务与祖先节点一起层级显示，

      <img alt="image" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/image-20250824102448-o8offcy.png" />
  - 任务右键菜单支持创建子任务
  - 支持显示所属项目，并支持点击项目名称打开项目管理面板
  - 任务管理面板顶栏添加新建任务、四象限按钮
- ✨项目管理面板完善

  - 项目管理面板顶栏添加番茄钟按钮
- ✨四象限面板优化

  - 每个象限的创建的任务需要根据哪个象限创建的，自动放在哪个象限
  - 四象限面板顶部添加一个新建任务按钮，创建任务不特别指定象限，让系统根据任务的优先级和日期自动分配象限：
- ✨项目管理看板优化

  - 粘贴列表创建任务支持多层级列表，自动创建父子任务

    <img alt="image" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/image-20250824102513-qa1z2tv.png" />
  - 看板支持拖拽设置父子任务和调整排序

    <img alt="image" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/image-20250824102530-cwsjoe4.png" />
  - 父子任务完成优化：父任务完成，子任务自动完成




## v0.7.2 / 2025-08-23
- ✨任务添加优先级样式优化:添加颜色边框，与项目样式（只有左边框）区别
- ✨四象限: 
  - 任务优先级支持快速设置任务优先级功能
  - 支持番茄钟
  - 支持显示子任务和折叠子任务
  - 支持绑定块
- ✨任务管理面板: 判断绑定块优化

## v0.7.1 / 2025-08-23
- ✨ 四象限排序优化
  - 支持项目排序
  - 支持任务手动排序
- ✨四象限条件设置按钮：在顶栏添加一个设置按钮，可以设置紧急和重要判断规则
  - 重要：默认≥中优先级
  - 紧急：默认为三天内，

## v0.7.0 / 2025-08-23
- ✨ 新增四象限面板
- ✨ 项目看板优化
  - 如果文档被创建为项目了，则文档面包屑添加一个iconProject按钮，点击可以打开项目管理看板
  - 项目看板的project-kanban-title支持点击跳转到项目笔记
- ✨ 优化日历视图
  - 支持按分类和优先级显示任务颜色，支持持久化
  - 日历面板任务支持打开项目管理看板

## v0.6.3 / 2025-08-23
- ✨ feat(项目管理看板): 添加任务倒计时显示功能
  - 只有开始日期：显示距离开始的天数（"X天后开始"）
  - 只有截止日期：显示距离截止的天数（"X天截止"）
  - 同时有开始和截止日期：
    - 开始前：显示距离开始的天数（"X天后开始"）
    - 开始后：显示距离截止的天数（"X天截止"）

## v0.6.2 / 2025-08-22

- ✨ feat(项目管理看板): 支持子任务
- ✨ feat(项目管理看板): 支持显示完成时间
- ✨ feat(项目管理看板):支持跨状态拖拽排序，任务从待办拖动进行中，可以直接进行排序，选择插入到哪个任务旁边
- ✨ feat(项目管理看板): 改进文档菜单的「设置为项目笔记」，改名为「项目管理」,如果文档已经是项目，则打开项目管理看板


## v0.6.1 / 2025-08-22
- ✨ feat(任务管理):块包含链接，添加到任务，在任务管理面板中会将链接一起展现出来 [#19](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/19)
- ✨ feat(项目管理):项目管理支持自定义项目状态 [#24](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/24)
- ✨ feat(项目管理): 添加将任务添加到项目的功能
  - 在菜单中添加“添加到项目”选项
  - 显示添加到项目对话框以选择项目
- 💄 style(项目面板): 调整归档项目的透明度样式
  - 修改归档项目的透明度为 0.5
  - 更新相关样式以确保一致性
- ✨ feat(项目面板): 优化项目标题和删除项目功能
  - 根据项目是否有块ID动态设置标题样式和点击事件
  - 移除翻译函数t()的使用，直接使用中文文本
  - 添加取消按钮的事件监听器以关闭对话框
- ✨ feat(提醒): 添加任务时间通知标记功能
  - 如果任务时间早于当前时间，则标记为已通知
  - 对于全天任务，比较当天的结束时间
- ✨ feat(项目管理看板): 按顺序分配任务排序值
  - 获取当前项目中所有任务的最大排序值
  - 在创建任务时根据最大排序值分配新的排序值
## v0.6.0 / 2025-08-22
- ✨ feat: 支持项目看板模式 [#22](https://github.com/Achuan-2/siyuan-plugin-task-note-management/issues/22)


## v0.5.6 / 2025-08-12

* 🐛 正计时不参与计数的bug

## v0.5.5 / 2025-08-02

- 💄 style(对话框): 移除对话框最大高度限制，避免高度小时，出现两个滚动条

## v0.5.4 / 2025-07-31

- 💄 style(日历视图): 添加当前时间指示线及样式
- 💄 style(日历视图): 如果是未绑定块的事项，右键菜单不应该出现复制块引用
- 💄 style(日历视图): 日历视图布满窗口，不超出导致出现滑条
- 💄 style(番茄钟): 优化标题字体样式，支持显示emoji

## v0.5.3 / 2025-07-30

- ✨ feat(日历视图): 快速提醒如果在月视图添加事项、以及在周、日视图添加全天事项，默认不设置具体时间
- 💄 style(快速提醒): 优化快速提醒对话框样式

## v0.5.2 / 2025-07-29

- ✨ feat(时间线): 添加月度和年度平均专注时间数据统计
  - 实现获取每月和每年平均专注时间的功能
  - 更新时间线图表以支持平均数据的显示
  - 优化图表渲染逻辑，增强可读性 \## v0.5.1 / 2025-07-29
- 日历视图，切换前后时间（比如周视图切换前后周）会导致事项重复

## v0.5.0 / 2025-07-29

- ✨ 日历视图支持番茄专注
- ✨ 支持番茄钟统计

## v0.4.9 / 2025-07-29

- ✨支持鸿蒙平台

## v0.4.8 / 2025-07-28

- ✨ 支持绑定块时创建文档
- 💄 style(样式): 修改日历视图今日背景颜色
- ♻️ refactor(日历视图): 添加滚动时间设置
- ♻️ refactor(日历视图): 修改初始视图为周视图

## v0.4.7 / 2025-07-27

- ♻️ 优化时间段的设置与显示
- ✨ 日历视图适配手机端打开
- ♻️ 任务管理面板排序逻辑改进

## v0.4.6 / 2025-07-27

- ✨ 日历视图支持点击直接创建事项，创建的事项支持绑定块
- ♻️ 任务日期和提醒时间合并为任务日期

## v0.4.5 / 2025-07-16

手机端适配

- ✨ 支持手机端的点击跳转功能
- 💄 style(对话框): 优化对话框的最大高度和宽度

## v0.4.3 / 2025-07-13

- ✨ 任务管理面板和项目管理面板支持悬浮预览块，方便悬浮记录笔记
- ✨ 自动识别日期，支持设置是否添加时自动识别

## v0.4.2 / 2025-07-04

- 🐛Fix: 番茄钟继承失效了，会重新开始计时

## v0.4.1 / 2025-06-24

- ✨ feat(番茄钟): 改进计时逻辑，尝试避免思源笔记放在后台导致的计时错误
- 💄 style(番茄钟): 调整样式，缩小番茄钟Dialog，添加窗口阴影，添加部分css变量

## v0.4.0 / 2025-06-22

- ✨ feat(ReminderPanel): 改进倒计时显示逻辑以支持过期事件
- ✨ feat(ProjectPanel): 添加项目开始和倒计时显示

## v0.3.9 / 2025-06-22

- ✨ 随机提示音系统通知的休息秒数根据设置来更改
- 🐛 番茄钟双击编辑时长后，统计时长有误

## v0.3.8 / 2025-06-21

- 🐛 fix(提醒对话框): 修复添加提醒时，无法获取标题内容的问题

## 0.3.7 / 2025-06-21

- ✨ feat(设置面板): 添加番茄钟使用提示
- ✨ feat(番茄钟):番茄钟支持全屏模式
- ✨ feat(番茄钟): 随机提示音系统通知功能支持关闭
- 🐛 Fix(提醒对话框): 列表块添加到提醒，只取第一层级的内容
- 💄 style(番茄钟): 优化番茄钟header样式，添加鼠标悬停时显示的效果

## v0.3.6 / 2025-06-20

- 🐛 fix(批量添加提醒): 修复批量添加块不显示在文档所有提醒

## v0.3.5 / 2025-06-20

- ✨ feat(番茄钟): 插件设置里的番茄钟添加一个选项，番茄结束之后，是否弹出系统弹窗
- 🎨 refactor(番茄钟): 取消番茄钟mini模式恢复正常窗口时折叠统计数据
- ✨ feat(打开块): 优化打开块功能，在多个组件中统一使用 openBlock 方法
- ✨ feat(notify): 任务提醒时显示系统弹窗通知，支持点击跳转到相关块
- ✨ feat(notify): 新增每日通知时间设置功能,支持设置每天几点后进行全天通知，默认每天8点，设置值（0-24）
- 🐛 fix(任务管理): 重复任务会错误计数

## v0.3.3 / 2025-06-19

- 🌐 i18n优化

## v0.3.2 / 2025-06-18

- ✨ feat(番茄钟): 番茄钟支持设置每日专注目标，并显示进度条

## v0.3.1 / 2025-06-18

- ✨ feat(番茄钟): 新增自动模式和长休息设置
  - 添加自动模式相关属性
  - 实现自动切换到工作和休息阶段
  - 增加长休息间隔设置
- ✨ feat(设置面板): 改进设置面板，实现设置项的分组和展示

## v0.3.0 / 2025-06-17

- ✨ feat(openBlock): 思源官方的插件API貌似有问题，打开标题块会错误聚焦无法退出，尝试解决这个问题
- 🐛 fix(UI): 有时Dock栏按钮不显示
  - 在布局准备就绪时才添加dock栏和顶栏按钮

## v0.2.9 / 2025-06-17

- 📝 完善项目赞赏说明

  如果喜欢我的插件，欢迎给GitHub仓库点star和金钱赞赏，这会激励我继续完善此插件和开发新插件。

  个人时间和精力有限，如果项目star和赞赏人数过少，我会考虑停止维护此插件，不再回复用户问题和需求。

## v0.2.8 / 2025-06-17

- ✨ feat(智能识别日期): 完善对“yyyymmdd 做事”格式的识别

## v0.2.7 / 2025-06-16

- ✨ feat(文档全部提醒面板): 添加右键菜单功能，支持删除提醒
- ✨ feat(文档全部提醒面板): 添加新建提醒功能
- 💄 style(文档全部提醒面板): 优化文档提醒项的悬停效果

## v0.2.6 / 2025-06-16

- ✨ feat(任务管理面板):优先级排序模式下添加拖拽排序功能
- ✨ feat(项目管理面板):优先级排序模式下添加拖拽排序功能
- ✨ feat(提醒面板): 改进跨天事件的完成状态判断，今日已完成的跨天事件会在“今日已完成”和“已完成”中显示

## v0.2.5 / 2025-06-16

- ✨ feat(提醒面板): 跨天的任务勾选今天已完成，顶栏徽章和停靠栏徽章显示的任务数量需要更新
- ✨ feat(日期智能解析): 支持YYYYMMDD格式智能解析
- ✨ feat(文档树右键检测): 添加文档树右键菜单进行批量设置文档提醒和项目笔记

## v0.2.4 / 2025-06-16

- ✨ feat(番茄钟): 添加休息时的背景音，与工作背景音区别

## v0.2.3 / 2025-06-16

- ✨ feat(提醒面板): 跨天事件支持今日已完成标记

## v0.2.2 / 2025-06-16

- ✨ feat(音频): 优化随机提示音的预加载和播放逻辑
- 💄style（项目管理）：项目管理不同优先级添加背景色

## v0.2.1 / 2025-06-15

- ✨ feat(番茄钟): 添加背景音量控制功能
  - 番茄钟新增音量控制按钮，对背景声音进行控制（不调节通知声音）
  - 插件设置支持设置背景音量
- ✨ feat(番茄钟): 添加随机提示音停止逻辑
  - 在正计时和倒计时模式完成时停止随机提示音
  - 更新模式切换按钮的标题提示

## v0.2.0 / 2025-06-15

- ✨ feat(番茄钟): 优化获取本周专注时间的逻辑
  - 修改周开始日期为周一
  - 使用本地日期格式替代ISO字符串

## v0.1.9 / 2025-06-15

- 番茄钟周专注时间从周一开始
- 新增：项目管理
- 新增：查看文档所有提醒
- 番茄钟添加随机提示音功能
- 更换番茄钟默认背景音，减少插件体积

## v0.1.8 / 2025-06-14

- ✨ feat(批量操作面板): 添加批量设置分类、优先级和日期功能
  - 实现批量操作面板的样式和交互
  - 添加分类、优先级和日期的批量设置功能
  - 支持智能日期识别功能
  - 优化块列表的显示和交互
- 💄style(日历视图)：今日高亮使用--b3-theme-primary-lightest，兼容黑色主题

## v0.1.7 / 2025-06-14

- 🐛Fix 番茄钟窗口的番茄计数完成后会重置，修改为不重置，番茄计数作为任务的总专注番茄数持续累计

## v0.1.5 / 2025-06-14

- 支持日期智能解析（暂不支持农历和重复事件）
  - 在添加提醒时，支持输入日期和时间，自动解析成正确的时间格式
  - 支持输入自然语言日期，如“明天”、“下周一”等
- 通知任务时弹出声音
- 修复通知全天事件将跨天事件认为是过期事件
- 修复设置时间后就立马通知的bug

## v0.1.4 / 2025-06-13

- 任务管理面板界面优化
  - 筛选添加
    - 今日已完成
    - 未来七天
  - 排序
    - 支持倒序和逆序
    - 按时间排序，会在时间排序的基础上按优先级排序
    - 去除按创建时间排序这个排序方式
    - 查看今日已完成和已完成的默认排序改进：优先按照时间来排序
- 番茄钟优化
  - 如果一个番茄钟正在运行，右键另一个事件进行番茄计时，如果确认替换，可以继承之前的番茄时间，继续计时
- 日历视图优化
  - 改进块事件在日历视图的显示，块事件的文档标题在日历视图里也要显示，显示在块事件标题的上方
  - 完成事项样式优化
- 改进完成事项的处理
  - 完成事项后，添加完成时间显示
  - 完成事项改为添加 ✅ 书签，并且给添加 custom-task-done 属性，设置值为当前日期 + 时间
  - 如果块是任务列表项，事项完成后会自动勾选，取消完成后会自动取消勾选

## v0.1.3 / 2025-06-12

- ✨ 默认设置番茄钟声音

## v0.1.2 / 2025-06-12

- ✅番茄钟优化
  - ✅番茄钟样式优化，圆环计时中间添加emoji图标，按钮默认鼠标悬浮才显示
  - ✅番茄钟添加mini模式，点击按钮可以切换
  - ✅打开番茄钟，显示的事件标题可以跳转到笔记
  - ✅如果已经有番茄钟，有一个窗口询问询问是否替换当前事件
  - ✅番茄钟默认放在右下角
- ✅事项提醒通知优化
  - ✅修改事项的时间，如果时间比当前时间晚，notified需要重新设置为false
  - ✅ 添加自定义通知对话框功能，这样可以持久化提醒
  - ✅一天开始（6点以后）会提醒一次今天的所有事件
- ✅添加提醒优化
  - ✅添加提醒时，自动选择分类和优先级
  - ✅优化设置提醒和修改提醒面版
  - ✅添加提醒默认为全天事件
- ✅任务管理面板界面优化
  - 优化管理面板分类展示，展示事件分类时还需要展示分类emoji
  - 面板右键支持复制块引
  - 打开块改用 api 打开 openTab，兼容浏览器端
- ✅块事件而非文档块需要显示所属文档的标题，在块事件名称上一行显示
- ✅日历视图支持鼠标悬浮显示事件详情

## v0.1.1 / 2025-06-11

- 文案优化

## v0.1.0 / 2025-06-11

- 添加提醒默认为全天事件

## v0.0.9 / 2025-06-11

- 文案优化

## v0.0.8 / 2025-06-11

- 明日提醒优化，跨天事件如果包含明天，也要显示

## v0.0.7 / 2025-06-11

- 改进过去七天提醒的展示逻辑
- 改进过期和跨天事件判断逻辑

## v0.0.6 / 2025-06-11

- ✨ feat(批量提醒): 美化批量提醒对话框样式和功能
  - 增加批量提醒对话框的样式
  - 调整对话框高度以适应内容
  - 优化批量提醒备注输入框样式

## v0.0.5 / 2025-06-11

- 在创建提醒时给对块添加⏰书签，在完成/删除提醒后检查该块是否还有未完成的提醒，如果没有则移除书签
- 现有提醒列表，如果事项已经完成，则透明度设置为0.5

## v0.0.4 / 2025-06-11

- 全部提醒的展示逻辑有点问题，和今日提醒效果一样？干脆改为过去七天提醒（包括今天）

## v0.0.3 / 2025-06-11

- 双击修改番茄时间
- 番茄钟正计时

## v0.0.1 / 2025-06-11 初始版本发布

实现功能
- **提醒设置**：支持为文档或块设置时间提醒，包含重复提醒功能。
- **分类管理**：为提醒添加分类，方便组织和筛选。
- **优先级设置**：支持高、中、低及无优先级设置。
- **番茄钟管理**：记录工作时长、休息时长及长休息时长，支持背景音设置。
- **日历视图**：提供直观的日历视图，方便查看和管理提醒。
- **批量设置提醒**：支持为多个块同时设置提醒。
- **徽章提醒**：在顶栏和停靠栏显示未完成提醒数量。
- **通知功能**：到达提醒时间时自动弹出通知。