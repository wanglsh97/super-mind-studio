## 1. 契约、数据库与配置基线

- [ ] 1.1 扩展 SDK/API Agent Run mode、`generate_image` Tool参数/result、图片状态与受控资源路由类型，保持普通Run和既有Tool兼容
- [ ] 1.2 扩展Prisma ImageGenerationTask、AgentRun/ToolCall关联、参考图片链、轮询lease、Sandbox结果和取消/过期字段，并生成正式向后兼容migration
- [ ] 1.3 定义PENDING、SUBMITTING、RUNNING、PERSISTING、SUCCEEDED、FAILED、CANCEL_REQUESTED、CANCELLED、EXPIRED、SUBMISSION_UNKNOWN状态机及终态幂等测试
- [ ] 1.4 仅增加百炼北京 Base URL/API Key 两项图片配置并校验必须同时存在；四模型、运行参数和三小时 Sandbox 默认值由代码内置，确保日志和配置错误不泄露密钥
- [ ] 1.5 建立无真实模型、无外部网络的去敏HTTP fixture基线，验证Web → SDK → API → Agent Run → Tool → fixture Transport → SSE → PostgreSQL日志纵向链路

## 2. 图片模型目录与百炼Adapter

- [ ] 2.1 实现仓库内版本化ImageModelCatalog，配置Qwen Image默认模型及万相、可灵、Vidu的平台ID、展示信息和能力矩阵
- [ ] 2.2 实现共享BailianImageTransport，覆盖配置的北京 Base URL/API Key 鉴权、Qwen同步结果、其余模型异步提交/查询、内置超时、AbortSignal、取消尝试和错误归一化
- [ ] 2.3 实现Qwen Image mapper与fixture contract test，映射文生图、参考图、1:1/2K默认值和水印参数
- [ ] 2.4 实现Wan mapper与fixture contract test，映射文生图、参考图、质量/比例和水印能力
- [ ] 2.5 实现Kling mapper与fixture contract test，映射文生图、参考图、resolution/aspect ratio和水印能力
- [ ] 2.6 实现Vidu mapper与fixture contract test，映射文生图、参考图、resolution/aspect ratio和水印能力
- [ ] 2.7 收敛生产Image Adapter registry，删除`mock-image`公开目录、固定Controller解析和相关生产配置，同时保留纯测试Transport注入能力
- [ ] 2.8 测试禁用模型、非法上游ID、任意URL/路径、非法参数、重复Tool调用和模型间禁止自动failover

## 3. 内置gen-image Skill与Agent Tool编排

- [ ] 3.1 新增仓库标准`gen-image/SKILL.md`及必要资源，规定默认生成、连续修改、一次Run一次Tool和结果后提示策略
- [ ] 3.2 将`gen-image`纳入内置Skill registry，启动时校验缓存并在损坏时fail fast
- [ ] 3.3 `image` mode在首次模型调用前自动激活Skill并注册`generate_image`，普通Run保持隔离
- [ ] 3.4 实现运行时图片模型能力上下文，向Agent提供平台模型、特点和可调参数但不暴露厂商鉴权或真实协议
- [ ] 3.5 实现`generate_image` Tool参数校验、默认Qwen Image/1:1/2K/单图/无水印、模型目录解析和付费调用前事务
- [ ] 3.6 实现同一Thread上一张有效图片解析、referenceImageId所有权校验和父子创作链，只向Provider提交一张参考图
- [ ] 3.7 将Sandbox参考图转换为模型内置的Base64/data URL输入，测试过期、越权、路径越界和跨Thread拒绝
- [ ] 3.8 测试Skill与用户Prompt注入顺序、当前文本模型保持、Agent调用一次Tool和Tool成功后最终模型总结

## 4. 持久Image Reconciler与Run恢复

- [ ] 4.1 实现付费提交前RequestLog、ImageGenerationTask和ToolCall原子创建，写库失败时fail closed
- [ ] 4.2 实现providerTaskId持久化、provider/task唯一约束和明确失败/提交不确定分类，SUBMISSION_UNKNOWN不得自动重提
- [ ] 4.3 实现API进程内Image Reconciler的PostgreSQL lease、小批量领取、nextPollAt退避和临时查询错误保态
- [ ] 4.4 实现终态条件更新、RequestLog/BillingRecord单事务终结和图片张数/版本化单价人民币费用快照
- [ ] 4.5 实现Provider结果安全下载，校验host、重定向、超时、长度、MIME、魔数和大小后写入受控Sandbox图片目录
- [ ] 4.6 实现Agent Tool result持久化和RunResumeService lease，API重启后重建tool-call/result历史并只执行一次最终文本总结
- [ ] 4.7 实现停止生成的CANCEL_REQUESTED、best-effort上游取消、CANCELLED终态和“可能仍产生费用”事件
- [ ] 4.8 覆盖API重启、双执行器竞态、查询429/5xx、上游失败、Sandbox写入失败、总结失败不重复生图和账单一对一集成测试

## 5. 三小时Sandbox临时图片

- [ ] 5.1 将全局Thread Sandbox生命周期统一调整为10800秒并同步配置示例和部署环境说明
- [ ] 5.2 实现平台imageId到当前用户/Thread/Sandbox受控文件的解析，API/SDK不得返回内部路径或Provider URL
- [ ] 5.3 实现临时图片owner-scoped预览和本地下载路由，设置私有缓存、nosniff、安全MIME和attachment文件名
- [ ] 5.4 实现Sandbox过期任务分类：未提交CANCELLED、已提交EXPIRED并best-effort取消、已成功未落盘结果丢弃且不新建Sandbox
- [ ] 5.5 测试三小时有效期、未保存图片过期提示、预览/下载失效、继续创作拒绝和日志/账单仍保留
- [ ] 5.6 回归验证三小时生命周期下普通Agent、网页开发和文档操作的Sandbox创建、复用、空闲和销毁行为

## 6. OSS保存与我的创作

- [ ] 6.1 实现临时图片显式保存服务，读取并校验Sandbox字节后写入不含Prompt的私有OSS对象键
- [ ] 6.2 在数据库事务中幂等创建IMAGE Creation/CreationAsset并关联图片任务，失败时best-effort清理新对象且不返回假成功
- [ ] 6.3 实现保存后owner-scoped永久预览和下载，删除/过期Thread Sandbox不得影响已保存资产
- [ ] 6.4 调整`/creations`只列出已保存图片并提供展示/下载，本期不提供图片删除和从Creation继续创作
- [ ] 6.5 测试下载不创建Creation、重复保存幂等、OSS/事务失败补偿、Thread删除后保留和跨用户资产隔离

## 7. Composer模式与Tool UI

- [ ] 7.1 在“网页开发”“文档操作”旁新增“图像生成”入口，并按Thread保持模式直到用户主动退出
- [ ] 7.2 图像模式继续展示文本模型选择器并提交当前文本模型，切换模式不得修改Thread模型绑定
- [ ] 7.3 实现`generate_image` Tool UI的submitting/pending/running/persisting/succeeded/failed/cancelled/expired/submission-unknown状态
- [ ] 7.4 成功卡实现预览、下载、保存和基于此图继续对话，并展示实际图片模型、Sandbox过期时间和保存状态
- [ ] 7.5 基于此图继续对话时设置当前创作链参考标识；允许自然语言切换图片模型且不弹出额外模型切换提示
- [ ] 7.6 最终assistant消息基于Tool能力提示可用替代模型和比例、质量、水印调整，不把Provider URL作为Markdown图片源
- [ ] 7.7 页面测试覆盖模式隔离、刷新恢复、文本模型保持、同Thread互斥、用户五活动Thread、停止和过期交互

## 8. 文档、离线质量门禁与真实启用

- [ ] 8.1 更新PRD、技术选型、Swagger/README和`.env.example`，同步Agent编排、百炼四模型、三小时Sandbox、显式OSS保存及风险边界
- [ ] 8.2 更新管理员模型/日志筛选与详情展示，支持四个图片模型、原始/有效Prompt、任务状态、实际费用且不泄露密钥或内部路径
- [ ] 8.3 运行相关SDK/API/Web单元、contract、集成和E2E测试，确认全部使用fixture且不访问真实模型
- [ ] 8.4 运行workspace format、lint、typecheck、build、Prisma migration validate和OpenSpec strict校验
- [ ] 8.5 不新增真实模型smoke CI脚本；按Qwen Image、万相、可灵、Vidu顺序人工执行最低成本请求并记录模型ID、北京地域、参数、结果、费用和关闭方法
- [ ] 8.6 确认外部内容安全前置条件、百炼低额度账户和私有OSS配置后逐模型启用，最后开放Composer入口
- [ ] 8.7 执行部署回滚演练：同时清空 Base URL/API Key、停止新任务、继续终结已提交任务并保留已保存作品、日志和账单
