// A simple HTTP server that listens on a specified host and port
import http from 'http';
import path from 'path';

export interface ServerOptions {
  /**
   * **Core feature of Fluxion**
   *
   * js, html, css, etc. files will be served from this directory
   * - Working samely as **PHP**
   */
  dynamicDirectory: string;

  host: string;

  port: number;
}

const defaultHandler: http.RequestListener = (req, res) => {
  if (req.url === undefined) {
    console.error('Received request with undefined URL');
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Bad Request: URL is undefined\n');
    return;
  }

  console.log(`Received request: ${req.method} ${req.url}`);
  const url = new URL(`http://${process.env.HOST ?? 'localhost'}${req.url}`);
  console.log(`url: `, url);
  const paths = path.join(...url.pathname.split('/').filter(Boolean));
  console.log(`paths: `, paths);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Server is running!\n');
};

/**
 * Start an HTTP server on the given host and port.
 * @param options ServerOptions with host and port
 * @param requestHandler Optional custom request handler
 * @returns The created http.Server instance
 */
export function startServer(
  options: ServerOptions,
  requestHandler: http.RequestListener = defaultHandler,
): http.Server {
  const server = http.createServer(requestHandler);
  server.listen(options.port, options.host, () => {
    console.log(`Server listening on http://${options.host}:${options.port}`);
  });
  return server;
}
