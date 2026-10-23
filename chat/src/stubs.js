// The stubs of the chat's two Durable Objects (AI coach spec, "Backend"; ruling R1). Everything that reaches the room
// or the coach makes its stub here: the Worker for each request, the room through coachStub() and Coach through
// roomStub(), which tests replace as they replace now().
//
// Only the first call that creates an object places it, so a stub made without the hint could put it somewhere else.
// Each object is one of a kind, found by name.

export const HINT = Object.freeze({ locationHint: "apac-ne" });

// The coach's name. If Bryan's check of /admin/where after the first deploy doesn't show Coach in Japan, Korea or
// Taiwan, this becomes "taiwan-2" before launch: an object never moves, and the AI isn't offered everywhere (spec,
// "Placement").
export const COACH_NAME = "taiwan";

// One room for all of Taiwan (Bryan, Oct 21). Its name never changes: the chat's data lives in it.
export const room = (env) => env.ROOM.getByName("taiwan", HINT);

export const coach = (env) => env.COACH.getByName(COACH_NAME, HINT);
