/**
 * ICE 候选收集诊断：验证 werift 在宿主机 vs 容器里能否正常生成 srflx 候选。
 */
import { RTCPeerConnection } from "werift";

const pc = new RTCPeerConnection({
  iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }],
});

let candCount = 0;
pc.onIceCandidate.subscribe((c) => {
  candCount++;
  console.log(`cand#${candCount}`, JSON.stringify(c));
});
pc.iceGatheringStateChange.subscribe((s) => console.log("gatheringState =", s));
pc.iceConnectionStateChange.subscribe((s) => console.log("iceConnection =", s));
pc.connectionStateChange.subscribe((s) => console.log("connection =", s));

const dc = pc.createDataChannel("diag", { ordered: true });
dc.onopen = () => console.log("dc open");

await pc.setLocalDescription(await pc.createOffer());
console.log("--- localDescription ---");
console.log(pc.localDescription.sdp);
setTimeout(() => {
  console.log(`--- final: gathering=${pc.iceGatheringState} candidates=${candCount} ---`);
  process.exit(0);
}, 8000);
