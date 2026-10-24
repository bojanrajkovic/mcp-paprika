// msw 3 (@mswjs/interceptors 0.45.x) intercepts at socket level and can misclassify a request
// written on a kept-alive socket, so it skips the handlers and hits the real network.
// See https://github.com/mswjs/interceptors/issues/862 and
// https://github.com/mswjs/interceptors/issues/879.
// Remove this file (and its vitest setupFiles entries) once a fixed @mswjs/interceptors ships.
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(new Agent({ keepAliveTimeout: 1, keepAliveMaxTimeout: 1, pipelining: 0 }));
