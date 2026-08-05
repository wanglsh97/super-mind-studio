# add-agent-web-generation

在既有 Agent Run 中新增 `mode: website`，由内置 `static-website-builder` Skill 规范建站，再由单一 `create_website` Tool 原子覆盖交付静态预览与两个 ZIP；最终产物进入“我的创作”并在 30 天后过期。
