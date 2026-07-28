# enable-production-admin-password-auth

将仅限开发联调的固定管理员账号升级为可在生产环境启用的独立密码凭据。生产服务器只保存密码哈希，
不保存或提交管理员明文密码。
