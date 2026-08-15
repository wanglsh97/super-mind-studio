## 1. 契约、模型目录与数据库基线

- [ ] 1.1 定义SDK/API的Thread视频mode、`generate_video` Tool参数/result、结构化建议、视频任务状态和受控资产路由类型，保持普通Agent与既有Tool兼容
- [ ] 1.2 调研并固化百炼北京地域可灵、HappyHorse、Vidu、爱诗首发具体模型ID及文生/首帧、音频、时长、分辨率、比例和模式能力矩阵，禁止运行时`latest`漂移
- [ ] 1.3 新增VideoGenerationTask、Thread视频软绑定、轮询lease、Sandbox输入/输出、provider最终状态、Creation关联和视频调用级计费字段，生成正式向后兼容Prisma migration
- [ ] 1.4 定义PENDING、SUBMITTING、RUNNING、PERSISTING、SUCCEEDED、FAILED、TIMED_OUT、CANCELLED状态机，保证平台终态不可逆且provider最终状态可独立对账
- [ ] 1.5 视频复用既有`BAILIAN_IMAGE_BASE_URL`和`BAILIAN_IMAGE_API_KEY`，仅增加默认视频品牌环境变量，其余视频参数使用平台常量，确保密钥、签名、内部路径及厂商URL不进入日志或客户端
- [ ] 1.6 建立四品牌去敏HTTP fixture和Mock文件存储基线，第一纵向切片验证Web → SDK → API → Agent → Tool → fixture Adapter → Reconciler → SSE → PostgreSQL

## 2. 百炼视频Adapter与能力路由

- [ ] 2.1 实现仓库内VideoModelCatalog，声明四品牌具体模型、两种输入链路和能力并集，并设置5秒/720P/文生16:9/音频开启默认值
- [ ] 2.2 实现Thread视频模型软绑定：首次选择环境变量配置的默认品牌、后续优先复用、能力不足时自动切换并只记录通用用户提示
- [ ] 2.3 实现最佳努力参数解析：聚合两条链路内能力，不支持的请求保留在Prompt并沿用上一版合法参数，不返回参数不支持错误
- [ ] 2.4 实现共享BailianVideoTransport，覆盖北京Endpoint、Bearer鉴权、异步请求头、提交、查询、best-effort取消、超时、AbortSignal和错误归一化
- [ ] 2.5 实现可灵文生/首帧Adapter及fixture contract test，覆盖音频、时长、720P/1080P和图像比例规则
- [ ] 2.6 实现HappyHorse文生/首帧Adapter及fixture contract test，正确选择t2v/i2v具体模型而不向上层暴露厂商ID
- [ ] 2.7 实现Vidu文生/首帧Adapter及fixture contract test，区分有声/无声具体版本和分辨率能力
- [ ] 2.8 实现爱诗PixVerse文生/首帧Adapter及fixture contract test，覆盖当前官方字段、输出和错误映射
- [ ] 2.9 测试候选过滤、HappyHorse默认选择、Thread复用、自动切换、品牌自然语言偏好、全模型不支持参数和实际模型对用户隐藏
- [ ] 2.10 测试所有明确提交/异步失败均直接失败，不自动重试、不重提、不切换Provider；恢复流程只查询原providerTaskId

## 3. 参考图Sandbox上传与临时OSS输入

- [x] 3.1 实现单张JPEG/PNG/WEBP、最大10 MB的owner-scoped上传接口，选择时直接写入私有临时OSS且不创建Sandbox副本
- [ ] 3.2 校验真实MIME、魔数、像素、透明通道和Thread归属，必要时在Sandbox内转换为厂商可接受的无透明JPEG/PNG
- [x] 3.3 SDK/Web仅保存opaque referenceAssetId，替换或取消未提交图片时best-effort清理，已提交任务输入由服务端管理
- [x] 3.4 实现临时OSS staging对象的30分钟只读签名HTTPS URL，替换/移除及任务终态best-effort删除且不创建Creation
- [ ] 3.5 测试临时对象任务隔离、签名期限、终态清理、提交失败补偿、进程崩溃生命周期兜底、跨用户边界和日志去敏

## 4. 内置视频Skill与Agent Tool编排

- [ ] 4.1 新增仓库标准视频生成Skill，规定发送即执行、默认参数、文本/单首帧边界、上下文继承、一次Run一次Tool和无视频编辑
- [ ] 4.2 将Skill纳入内置registry并在video mode首次模型调用前自动加载；普通conversation mode不注册`generate_video`
- [ ] 4.3 实现`generate_video` Tool服务端schema与权限校验，拒绝provider ID、真实model ID、任意URL、Sandbox路径和多媒体输入
- [ ] 4.4 实现上一版完整Prompt、首帧资产、有效参数和创作父链继承，新Prompt仅覆盖明确变化，生成视频永不成为下一轮输入
- [ ] 4.5 实现生成前外层Agent规划、Tool等待和成功后外层Agent最终回复，持久化足够历史以支持API重启后的Run continuation
- [ ] 4.6 定义并校验3–5条`label/prompt`结构化修改建议，Web不得执行模型定义的任意动作；最终文本模型失败时使用默认建议且不重新生视频
- [ ] 4.7 测试Skill加载顺序、现有文本模型保持、无需确认、一次Run一次Tool、模式隔离、上下文继承和Tool成功后恰好一次总结

## 5. 持久Video Reconciler、取消与计费

- [ ] 5.1 在付费调用前原子创建RequestLog、VideoGenerationTask和ToolCall关联，写库失败时fail closed
- [ ] 5.2 提交使用平台幂等键并立即持久化providerTaskId；网络不确定、API重启和Run恢复均不得创建替代付费任务
- [ ] 5.3 实现API进程内Video Reconciler的PostgreSQL lease、小批量领取、nextPollAt和独立于浏览器的持续查询
- [ ] 5.4 任务运行期间持有Thread Sandbox lease，成功落盘、失败、取消或超时后可靠释放
- [ ] 5.5 实现15分钟平台超时，终结Run且禁止迟到结果进入Sandbox或页面，不自动重试
- [ ] 5.6 实现用户停止后的立即逻辑CANCELLED、停止事件回吐、释放前台Thread锁、best-effort百炼取消及后台低频最终状态/费用对账
- [ ] 5.7 实现Tool result持久化和Run continuation lease，在线执行器与恢复执行器竞态时只完成一次最终Agent回合
- [ ] 5.8 实现视频调用级账本，记录实际模型、候选/切换审计、价格版本、秒数、分辨率、音频、平台/provider状态及估算人民币费用
- [ ] 5.9 覆盖页面关闭、API重启、双执行器竞态、逻辑取消后新Run、迟到成功、15分钟超时、账单幂等和实际模型不泄露的集成测试

## 6. MP4安全落盘与临时预览

- [ ] 6.1 实现最大500 MB的流式provider结果下载，限制HTTPS host/重定向并对DNS/IP执行SSRF防护
- [ ] 6.2 校验Content-Length、MIME、MP4魔数、基础轨道/时长和浏览器兼容性，同时计算SHA-256并在失败时清理半成品
- [ ] 6.3 将成功视频写入受控Thread Sandbox输出目录，空间不足时明确失败且不得删除其他产物或回退到隐式OSS
- [ ] 6.4 实现owner-scoped同源视频内容路由，支持Range/206/Content-Length、私有缓存、nosniff和正确`video/mp4`
- [ ] 6.5 实现Web对话流视频产物与浮层预览，关闭只停止播放；Sandbox过期后显示“临时视频已过期”
- [ ] 6.6 测试私网/回环、恶意DNS、非法重定向、超限、伪MP4、截断、编码不兼容、Range边界、跨用户访问和Sandbox过期

## 7. OSS永久化、下载与我的创作

- [ ] 7.1 扩展Creation/CreationAsset为VIDEO类型，记录threadId、runId、序号、parentCreationId、媒体元数据和不含Prompt的opaque OSS key
- [ ] 7.2 实现保存服务：校验live Sandbox视频和SHA-256、幂等写入私有OSS并事务创建永久Creation；数据库失败时best-effort补偿对象
- [ ] 7.3 实现下载先调用同一永久化链路，再从owner-scoped永久资产响应attachment；本地下载失败不回滚Creation
- [ ] 7.4 保证同一任务重复保存/下载只产生一个Creation和OSS对象，每个不同生成版本独立成卡且保留父版本元数据
- [ ] 7.5 扩展“我的创作”展示VIDEO卡片，提供永久Range预览、下载和删除，不实现版本树UI或回收站
- [ ] 7.6 实现可重试deleting状态与OSS对象清理，删除单个版本不得影响Thread、其他版本或日志账单
- [ ] 7.7 测试保存/下载幂等、下载即进入我的创作、OSS/事务补偿、本地下载失败、Sandbox销毁后永久可用、删除重试和跨用户隔离

## 8. Composer交互与端到端状态

- [ ] 8.1 在Composer上方增加“对话/视频生成”入口，并按Thread服务端持久化与刷新恢复，不增加视频模型选择器
- [ ] 8.2 视频模式支持参考图上传/替换/移除状态，上传成功前不得创建Run或调用百炼
- [ ] 8.3 实现视频Tool UI的preparing/submitting/running/persisting/succeeded/failed/timed-out/cancelled/expired状态和停止操作
- [ ] 8.4 成功消息提供预览、保存、下载及3–5条建议气泡，点击建议直接append Prompt并启动下一Run
- [ ] 8.5 自动换模型仅弹通用提示；普通用户页面、SDK响应和消息不得出现候选集合、实际品牌、model ID、切换原因或费用
- [ ] 8.6 页面E2E覆盖模式切换、刷新恢复、发送即生成、首帧上传、关闭页面恢复、停止后立即新Run、失败无自动重试、建议修改、预览、保存、下载和过期

## 9. 管理后台、文档与发布验收

- [ ] 9.1 扩展管理员任务/日志/计费查询和详情，支持品牌、实际模型、状态、日期、生成秒数、音频、取消/超时、路由原因和人民币费用筛选
- [ ] 9.2 更新PRD、技术选型、Swagger/README、`.env.example`和部署runbook，说明四品牌、两条输入链路、Sandbox/OSS、15分钟超时和已接受风险
- [ ] 9.3 明确记录不提供用户/开关控制、平台内容审核、视频成本硬顶、取消防刷、转码、视频编辑和自动重试，禁止将厂商审核描述为完整保障
- [ ] 9.4 运行SDK/API/Web相关unit、contract、integration和E2E，确认fixture模式不访问外部网络或产生费用
- [ ] 9.5 运行workspace format、lint、typecheck、build、Prisma migration validate和OpenSpec strict校验
- [ ] 9.6 按可灵、HappyHorse、Vidu、爱诗逐个执行北京地域最低成本人工冒烟，记录具体模型ID、文生/首帧、5秒720P音频、结果格式、费用和停用方法
- [ ] 9.7 完成部署与回滚演练：停止新视频Run后继续对账已提交任务，保留永久OSS作品、日志、任务和账单
