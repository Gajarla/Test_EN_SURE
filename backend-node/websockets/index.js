const WebSocket = require('ws');
const queryString = require('query-string');


module.exports = async (expressServer) => {
    const websocketServer = new WebSocket.Server({
      noServer: true,
      path: "/websockets",
    });
  
    expressServer.on("upgrade", (request, socket, head) => {
      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        websocketServer.emit("connection", websocket, request);
      });
    });
  
    websocketServer.on(
      "connection",
      function connection(websocketConnection, connectionRequest) {
        const [_path, params] = connectionRequest?.url?.split("?");
        const connectionParams = queryString.parse(params);
  
        console.log(connectionParams);
  
        websocketConnection.on("message", (message) => {
          const parsedMessage = JSON.parse(message);
          console.log(parsedMessage);
          websocketConnection.send(JSON.stringify({ message: 'WebSockets: Message Received' }));
        });
      }
    );
  
    return websocketServer;
  };