import http from 'node:http';
import {createHash} from 'node:crypto';
import {once} from 'node:events';

// Only a local peer; no package, credential, production URL or network fallback.
export async function localTailPeer({respond=true,handshake=true}={}){
 const sockets=new Set(),server=http.createServer();let client;
 server.on('upgrade',(req,socket)=>{
  sockets.add(socket);client=socket;socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  if(!handshake)return;
  const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\nSec-WebSocket-Protocol: trace-v1\r\n\r\n');
  let pending=Buffer.alloc(0);
  socket.on('data',data=>{
   pending=Buffer.concat([pending,data]);
   while(pending.length>=2){
    let length=pending[1]&127,offset=2;
    if(length===126){if(pending.length<4)return;length=pending.readUInt16BE(2);offset=4;}
    if(length===127){socket.destroy();return;}
    if(pending[1]&128)offset+=4;
    if(pending.length<offset+length)return;
    const opcode=pending[0]&15;pending=pending.subarray(offset+length);
    if(opcode===8&&respond)socket.end(Buffer.from([0x88,0]));
   }
  });
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 return {
  url:'ws://127.0.0.1:'+server.address().port,
  send(value){
   const data=Buffer.from(typeof value==='string'?value:JSON.stringify(value));
   const header=data.length<126?Buffer.from([0x81,data.length]):Buffer.from([0x81,126,data.length>>8,data.length&255]);
   client?.write(Buffer.concat([header,data]));
  },
  disconnect(){client?.destroy();},
  // The client must release its own transport; do not hide liveness defects by
  // destroying the peer's sockets. The parent watchdog kills only a stuck child.
  release(){server.close();for(const socket of sockets)socket.unref();},
  destroy(){for(const socket of sockets)socket.destroy();server.close();},
 };
}
