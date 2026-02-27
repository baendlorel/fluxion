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
