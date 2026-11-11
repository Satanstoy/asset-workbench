# 素材制作工作台

按模板上传图片，提交模拟制作任务，再从详情页或个人历史查看进度和结果。支持两个独立的演示身份。项目约定见 [CONTEXT.md](./CONTEXT.md)、[总规格](./outputs/素材制作工作台-开发规格.md)、[后端规格](./docs/specs/backend.md)和[前端规格](./docs/specs/frontend.md)。

## 启动与技术版本

```sh
docker compose up --build
```

打开 `http://127.0.0.1:3000`。同源的 `/api/health` 可检查 Java 与 MySQL 的连接。Compose 启动时创建数据库，Java 初始化库表和种子模板。MySQL 和用户上传文件分别保存在 `mysql-data` 和 `assets-data` 数据卷。

| 目录 | 用途 |
| --- | --- |
| `frontend/app` | Next.js App Router 页面和同源转发入口 |
| `frontend/features` | 演示身份、模板浏览、素材上传和任务跟踪 |
| `frontend/tests` | Playwright 页面交互与真实后端联通测试 |
| `backend/src/main` | Java 业务、MyBatis、SQL 初始化和本地演示图 |
| `backend/src/test` | Java 工作流、写入恢复与 HTTP 集成测试 |
| `backend/tests` | pytest 通过真实 Java HTTP 与 MySQL 验证 API、事务及重启 |

前端使用 Node.js 24、Next.js 16.4.6、React 19.3.1、TypeScript 5.9.3 和 Playwright 1.65.0。后端使用 Java 17、Spring Boot 3.5.16、MyBatis Starter 3.0.5、Maven Wrapper 3.9.16 和 MySQL 8.4。npm 依赖由锁文件固定，Java 依赖由 Maven 父 POM 和项目 POM 管理。

### 配置

| 配置 | 默认值或示例 |
| --- | --- |
| `FRONTEND_PORT` | Compose 默认 3000 |
| `BACKEND_URL` | Next.js 本地默认 `http://127.0.0.1:8080`，容器构建时使用内部地址 `http://backend:8080` |
| `DB_URL` | Java 本地默认 `jdbc:mysql://127.0.0.1:3306/asset_workbench`，Compose 使用内部数据库地址 |
| `DB_USER`、`DB_PASSWORD` | 演示使用 `workbench` 和 `workbench-local` |
| `MYSQL_ROOT_PASSWORD` | Compose 演示值 `root-local` |
| `ASSETS_DIRECTORY` | Java 本地默认 `./data/assets`，Compose 挂载到 `/app/data/assets` |
| `SIMULATION_ENABLED` | Java 直接运行默认关闭，Compose 演示默认开启 |

示例值见 `.env.example`，均为本地测试用。单独启动时，先准备 MySQL 8.4、空的 `asset_workbench` 数据库和具备该库权限的用户，再分别在前后端目录运行。

```sh
(cd backend && SIMULATION_ENABLED=true ./mvnw spring-boot:run)
(cd frontend && npm ci && npm run dev)
```

## 演示路线

1. 打开模板列表，切换「创意图片」和「拼贴设计」。进入旅行明信片或双图拼贴，选择演示用户 A。
2. 上传一张或两张 JPEG、PNG，观察预览和上传位的状态。项目中的封面图也可以作为上传样例，见 `backend/src/main/resources/demo-images`。
3. 点击「开始制作」。受理后卡片出现在详情页，仍可用当前素材再提交一项。打开个人历史或刷新，观察任务继续推进。
4. 成功后预览结果图。切换 B 后看不到 A 的记录，切回 A 可找回。演示身份允许任何访客切换，用于验证业务归属。
5. 以下命令提交一项在模拟生成阶段失败的慢任务，再提交一项正常任务。命令需要 `curl` 和 Python 3，默认 Compose 已启用模拟控制。命令完成后，在网页选择演示用户 A 查看这两项任务。

```sh
base=http://127.0.0.1:3000
demo_dir=$(mktemp -d)
curl --fail-with-body -sS -c "$demo_dir/cookies" -H 'Content-Type: application/json' \
  -d '{"userId":"demo-a"}' "$base/api/session"
asset_id=$(curl --fail-with-body -sS -b "$demo_dir/cookies" \
  -F 'templateId=postcard' \
  -F 'file=@backend/src/main/resources/demo-images/postcard-cover.png;type=image/png' \
  "$base/api/assets" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

curl --fail-with-body -sS -b "$demo_dir/cookies" -H 'Content-Type: application/json' \
  -d "{\"templateId\":\"postcard\",\"assetIds\":[\"$asset_id\"],\"simulation\":{\"stageDelayMs\":3000,\"failAtStage\":\"GENERATE\"}}" \
  "$base/api/tasks"
curl --fail-with-body -sS -b "$demo_dir/cookies" -H 'Content-Type: application/json' \
  -d "{\"templateId\":\"postcard\",\"assetIds\":[\"$asset_id\"],\"simulation\":{\"stageDelayMs\":1000}}" \
  "$base/api/tasks"
curl --fail-with-body -sS -b "$demo_dir/cookies" "$base/api/tasks"
```

`failAtStage` 还可以设为 `CHECK_ASSETS` 或 `FINALIZE`。省略失败阶段即可走成功路径。单阶段耗时可设为 0–10000 毫秒，默认 2000。需要验证重启时，先让一项任务进入处理中并排入另一项，然后运行 `docker compose restart backend`，重新选择 A 查看记录。

## API 与数据约定

所有接口由 Java 提供。浏览器请求同源的 Next.js 路径，使用 HttpOnly 会话 Cookie。接口完整字段见[后端规格](./docs/specs/backend.md)。

| 方法与路径 | 输入与成功结果 |
| --- | --- |
| `GET /api/session`、`POST /api/session` | 查询或通过 `userId` 切换 A/B。返回当前演示身份。 |
| `GET /api/templates`、`GET /api/templates/{id}` | 列表可按 `category` 筛选。返回模板和图片要求。 |
| `POST /api/assets` | multipart 的 `templateId`、`file`。201 返回素材 ID、实际格式和大小。 |
| `POST /api/tasks` | `templateId`、有序 `assetIds`、可选 `simulation`。202 返回已受理的任务记录。 |
| `GET /api/tasks`、`GET /api/tasks/{id}` | 读取个人历史或一项任务。列表支持 `templateId` 与 `activeOnly=true`。 |
| `GET /api/demo-images/{filename}`、`GET /api/health` | 内置图片或服务健康状态。 |

任务受理时，在同一事务中保存任务和每个上传位的素材引用。MySQL 保存任务的整体状态和当前制作阶段。单 worker 按序领取 `PENDING`，在进入素材检查、模拟生成、结果整理前分别写入阶段。终态为 `SUCCEEDED` 或 `FAILED`。数据库暂时断连时，worker 暂停后续执行，恢复后先读回核对状态，避免重跑已完成阶段。服务进程重启时，遗留的处理中任务标为中断失败，等待中的任务继续执行。

可控 API 错误返回错误码和用户可读说明。参数无效返回 400，会话缺失返回 401，模板或任务不可见返回 404，上传超限返回 413，请求媒体类型不支持返回 415，服务暂不可用返回 503。制作失败写入任务的 `failure`，查询异常由前端单独展示。

## 测试

快速检查与工作流单元测试：

```sh
(cd backend && ./mvnw verify)
(cd frontend && npm ci && npm run lint && npm run typecheck && npm run build)
(cd frontend && npx playwright install chromium && npm test)
```

使用测试 MySQL 运行 Java HTTP 集成测试时，设置 `TEST_DB_URL`、`TEST_DB_USER` 和 `TEST_DB_PASSWORD` 后执行 `./mvnw verify`。pytest 要求运行真实 Java 服务和隔离的 MySQL。使用 Python 3.12 安装 `backend/requirements-test.txt`，设置以下变量并运行 `python -m pytest -q backend/tests`：

- `API_BASE_URL`、`TEST_DB_HOST`、`TEST_DB_PORT`、`TEST_DB_NAME`、`TEST_DB_USER`、`TEST_DB_PASSWORD` 指向测试环境。
- `TEST_ASSETS_DIRECTORY` 指向测试 Java 使用的上传目录。事务测试会在测试库临时创建触发器注入失败，需要具备触发器权限。测试库开启二进制日志时，CI 在隔离环境开启 `log_bin_trust_function_creators`。
- `BACKEND_JAR`、`TEST_RESTART_DB_NAME` 启用重启测试。重启测试使用独立数据库并由 pytest 管理测试 Java 进程。
- 前端真实联通测试用 `PLAYWRIGHT_REAL_API=1 BACKEND_URL=http://127.0.0.1:8080 npm test`，并在 Java 开启模拟控制。可用 `PLAYWRIGHT_CHANNEL=chrome` 使用本机 Chrome。

GitHub Actions 在 push 和 pull request 中启动独立 MySQL，运行 Java 测试、pytest、Playwright 及前端 lint、类型检查和构建。

本地验收通过 11 项 Java 测试、14 项 pytest 和 10 项 Playwright。三服务容器验收使用 Maven 打包的 Java JAR，浏览器闭环和 MySQL 记录检查均通过。独立运行 `docker compose up --build` 时，镜像和 npm 依赖下载遇到连接中断，源码构建验收待重跑。

## 部署、回滚与范围

部署时记录验收 commit，准备对应的配置，运行 `docker compose up -d --build`，再检查 `/api/health` 和一次制作闭环。回滚前备份 MySQL 和上传卷，切换到已验证的旧 commit 后重新构建启动。若版本间库表有变动，按相应版本的数据库备份恢复。 `docker compose down` 停止服务并保留数据。需要从空数据演示时，针对专用演示环境执行 `docker compose down -v`。

本版使用预置图模拟制作、演示身份和单实例 worker。执行中任务跨进程续跑、提交幂等、素材自动清理、生产认证和线上部署均属于后续范围。参考界面依据卷面文字和已确认的布局约定制作，卷面中仅见参考图编号。

开发采用 Grill Me 确认业务边界，先固定领域术语，再分别编写前端和后端规格。AI 协作按红灯、最小实现、绿灯推进。比如先用 MySQL 触发器让任务输入的第二次写入失败，再用 pytest 核对任务与第一项输入均回滚、API 返回结构化错误。Java 与 Next.js 项目骨架按各框架的公开用法创建，演示图为项目内程序生成的原创几何图案。

本轮实现和验证的会话记录约半小时，包含依赖下载、测试和修复。前期需求讨论及人工投入未单独计时。
