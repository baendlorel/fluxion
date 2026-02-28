请以http包、findmyway包，制作一个非常简单的服务器，要求：

1. 配置如下。

```json
{
  "dynamicDirectory": "string",
  "host": "string",
  "port": "number"
}
```

2. dynamicDirectory用来指定一个目录，这个目录下的代码结构为：

```text
dynamicDirectory
└─somemodule
  ├── server
  │   ├── index.js
  └── web
      ├── index.html
      └── style.css/main.js ...
```

3. dynamicDirectory是核心。服务器fs.watch这个目录.当这个目录下的文件变化，会触发diff。对于新增的somemodule，会将web下的内容注册为
   router `/somemodule/...`,而server的路由注册为`/somemodule/api`。 不见了的文件夹，则删除这两个路由。你暂时不需要处理web静态资源问题，先把路由注册和删除做好。

4. 在开始的时候，服务器会扫描dynamicDirectory下的所有somemodule，并注册路由。
5. 增加一个输出jsonline日志的机制。不过，路由的注册可以用oneline那种日志，比如

```
[timestamp] [INFO] Registered   route: /somemodule/
[timestamp] [INFO] Unregistered route: /somemodule/
```

---

你记住现在我们的项目叫fluxion，可以写在AGENTS.md里。我希望的是，假如我访问了/aaa/bb/cc这个路由，那么fluxion会寻找dynamicDirectory下的aaa文件夹里的server里的bb文件夹里的cc.js文件或者cc/index.js(优先)文件，以里面的函数作为handler来处理这个请求。这个函数的签名是`(req, res) => {}`，你可以在里面写任何逻辑来处理请求和响应。我不知道await import(xxx)能否胜任以及它缓存是否原生，或者是否有性能问题。我希望的是加载这个js文件的default导出。
请你评估这个方案
