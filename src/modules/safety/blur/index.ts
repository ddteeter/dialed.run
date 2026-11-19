/**
 * The blur sub-module's door (design 240). It exports nothing: blur runs in
 * the browser, and its one consumer, `components/PhotoBlur.tsx`, imports
 * its files directly, as every component does. The door is what makes
 * `blur/` a unit of its own, and it must never reach `env`.
 */
export {};
