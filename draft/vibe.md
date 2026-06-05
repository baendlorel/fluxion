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

---

worker优化：
1、直接从worker返回你说的buffer来限制大小、判定,减少拷贝传输成本避免内存膨胀；
2、mjs编写的时候可以选择自己需要远程的什么对象，比如{handler,db:['pg','xxxDB']}等；handler里会传入第三个入参context来包含这些功能;
3、实现workerstrategy这个方案。

---

现在，请你把db config的interface保留下来。我已经删除了pg和mysql2依赖，因为它们不应该这样写，它们应该在用户npm install fluxion后由用户自行安装引入，fluxion只做配置传递。为不失一般性，mjs返回的不再是db:{key:value}，而是modules:[{module:'mysql2',injectKey:"mydb",factory:(...)=>{ 这里返回最终注入context的对象}}]。而这个modules数组将会传输到worker，其中，factory因为是函数，所以会tostring后传输，传输到worker内部后再new Function的形式绕回来,而最终这个数据库链接实例会出现在context.mydb。

---
优化router.ts的register函数：
1、目前`// register as api`这里是定死的，但我希望FluxionOptions以及后续的其他类型里，
增加一个字段叫apiExts，类型为string[]，也就是要能够做到，如果后缀名在这个数组里，
将会被读取为handler并注册成api，其余情况被注册为静态元素。
2、再增加routerExclude，也是string[]，表示满足这个东西的后缀名将不会被注册。首先，register将会尝试检查是否存在它，如果存在就删除，但走到注册的这一步就立刻返回，它表示排除这个