// A simple HTTP server that listens on a specified host and port
import http from 'http';

export interface ServerOptions {
  host: string;
  port: number;
}

/**
 * Start an HTTP server on the given host and port.
 * @param options ServerOptions with host and port
 * @param requestHandler Optional custom request handler
 * @returns The created http.Server instance
 */
export function startServer(options: ServerOptions, requestHandler?: http.RequestListener): http.Server {
  const handler: http.RequestListener =
    requestHandler ||
    ((req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Server is running!\n');
    });
  const server = http.createServer(handler);
  server.listen(options.port, options.host, () => {
    console.log(`Server listening on http://${options.host}:${options.port}`);
  });
  return server;
}
