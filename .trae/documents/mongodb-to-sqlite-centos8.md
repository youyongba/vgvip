# MongoDB 迁移到 SQLite 实施计划

## Context

将项目的 MongoDB/Mongoose 数据层完整替换为 SQLite，使应用可部署在 CentOS 8.5、Node.js v20.20.2。保持订单创建、精确金额核对、续期、会员锁、对账任务锁、邀请链接及现有 API 响应行为不变。本次切换后首次启动创建空库，不包含 MongoDB 历史数据导入。

## 技术方案

- 使用精确锁定版本的 `better-sqlite3@12.11.1`；Node 20 不使用内置 `node:sqlite`，不引入 ORM。
- 使用本地 SQLite 文件，默认 `data/telegram-vip.sqlite`，通过 `SQLITE_PATH` 配置。
- 启动时自动创建父目录、表和索引，启用 WAL、外键及 busy timeout。
- 订单 ID 继续生成 24 位十六进制字符串；日期以毫秒整数存储、读取时恢复为 `Date`；布尔值以 0/1 存储、读取时恢复为 boolean。
- `expectedRaw` 继续使用十进制字符串进行精确支付匹配，`amount REAL` 仅用于展示。
- 支付激活使用 `BEGIN IMMEDIATE` 短事务；会员、worker、邀请锁均使用带所有者及租约条件的原子 UPDATE，网络请求不放进事务。

## 文件改动

1. **依赖与配置**
   - 修改 [package.json](file:///Users/qihong/telegram-vip-bot/package.json) 和锁文件：移除 `mongoose`，加入固定版本 `better-sqlite3`。
   - 修改 [src/config/index.js](file:///Users/qihong/telegram-vip-bot/src/config/index.js) 和 [.env](file:///Users/qihong/telegram-vip-bot/.env)：将 `mongo.uri` / `MONGO_URI` 替换为 `sqlite.path` / `SQLITE_PATH`，不改动其他配置。
   - 新增 `.gitignore`，忽略 SQLite 数据库及 WAL/SHM 文件；移除不再适用的 [mongodb_config.sh](file:///Users/qihong/telegram-vip-bot/mongodb_config.sh)。

2. **数据库初始化和模型**
   - 重写 [src/services/db.js](file:///Users/qihong/telegram-vip-bot/src/services/db.js)：提供 `connectDB`、`getDB`、`closeDB`、事务及健康检查；保留原 `connectDB` 启动入口。
   - 重写 [src/models/subscription.js](file:///Users/qihong/telegram-vip-bot/src/models/subscription.js)：建立 `subscriptions` 表的数据访问方法，保留 camelCase 业务字段；实现交易哈希、金额预留、开放订单唯一部分索引，以及状态/时间查询索引。
   - 重写 [src/models/member.js](file:///Users/qihong/telegram-vip-bot/src/models/member.js)：建立 `members` 表的数据访问方法，覆盖会员查询、upsert、Telegram ID 绑定、续期及锁操作。
   - 所有更新显式维护 `updatedAt`，支付不可变字段不提供通用修改入口。

3. **业务调用替换**
   - 修改 [src/services/payments.js](file:///Users/qihong/telegram-vip-bot/src/services/payments.js)：移除 Mongoose session；创建订单时处理 SQLite 唯一约束冲突；支付事务内重新校验订单和会员锁，原子完成续期、旧 active 订单过期和交易哈希写入；worker 通过短事务认领任务。
   - 修改 [src/services/membership.js](file:///Users/qihong/telegram-vip-bot/src/services/membership.js)、[src/services/scheduler.js](file:///Users/qihong/telegram-vip-bot/src/services/scheduler.js)：替换邀请锁、到期清理、提醒标记等查询，保留锁所有者校验和网络调用顺序。
   - 修改 [src/routes/api.js](file:///Users/qihong/telegram-vip-bot/src/routes/api.js) 和 [src/bot/handlers.js](file:///Users/qihong/telegram-vip-bot/src/bot/handlers.js)：改用明确的数据访问方法，保持用户名 ASCII 大小写不敏感、状态排序、Telegram ID 绑定条件及 API 字段不变；`/api/test-db` 改为 SQLite 健康查询。
   - [index.js](file:///Users/qihong/telegram-vip-bot/index.js) 启动流程保持不变，数据库初始化成功后再启动定时任务和 HTTP 服务。

4. **测试和现有文档**
   - 改造 [src/services/payments.test.js](file:///Users/qihong/telegram-vip-bot/src/services/payments.test.js)：使用独立 `:memory:` SQLite 数据库，不再依赖或跳过 MongoDB 副本集测试；保留纯函数、Tron 匹配、QR、邀请和路由测试，验证支付幂等、重复交易完整回滚、续期累计、金额唯一、锁重试和 worker 单次认领。
   - 更新 [README.md](file:///Users/qihong/telegram-vip-bot/README.md) 与 [docs/API.md](file:///Users/qihong/telegram-vip-bot/docs/API.md) 中直接相关的 MongoDB 配置、启动日志和 ObjectId/timestamps 描述，补充 CentOS 8.5 原生模块构建说明。

## CentOS 8.5 部署要求

- 使用 Node.js v20.20.2，在目标机安装依赖，不复制 macOS 的 `node_modules`。
- 安装 Python 3、make 和可用的 C++ 编译工具链；若预编译包不匹配 CentOS 8.5，则执行 `npm ci --build-from-source` 从源码构建 better-sqlite3。
- SQLite 文件放在应用账号可写的本地磁盘目录，不放在 NFS/CIFS；备份时同时处理数据库及 WAL 文件。

## 验证

1. 在 Node v20.20.2 下干净安装依赖，加载 better-sqlite3 并创建内存数据库。
2. 运行 `npm test`，确认不再需要 MongoDB 服务，全部支付集成测试实际执行。
3. 使用临时 `SQLITE_PATH` 启动应用，检查自动建表、`/api/test-db`、创建/恢复订单及订单详情接口。
4. 验证到账激活、重复激活、两笔续期、重复交易哈希回滚、pending → reconciling → manual_review、邀请生成及到期清理。
5. 重启应用确认 SQLite 数据持久化；最终在 CentOS 8.5 目标机执行相同安装、测试和启动检查。
