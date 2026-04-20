// 1. 切换到你要创建用户的数据库（或者 admin 库）
use tg_vip_bot

// 2. 创建用户 tg_vip_bot_user，密码为 qihong，并赋予读写权限
db.createUser({
  user: "tg_vip_bot_user",
  pwd: "qihong",
  roles: [
    { role: "readWrite", db: "tg_vip_bot" }
  ]
})

// 3. 退出 mongosh
exit