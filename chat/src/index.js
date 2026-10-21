// The front Worker of the Taiwan chat (spec "Backend: chat/"). It exports the room, the Durable Object that
// holds everything. The routes come next; until then every request gets a 404.
export { Room } from "./room.js";

export default {
  async fetch() {
    return Response.json({ error: "not found" }, { status: 404 });
  },
};
