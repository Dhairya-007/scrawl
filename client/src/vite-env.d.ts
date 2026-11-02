/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Where the game server lives. Left unset the client talks to its own
   * origin, which is how local development and the single-service deploy both
   * work. It is only needed when the client is hosted apart from the server —
   * on a static host such as Netlify, which cannot hold a socket open.
   */
  readonly VITE_SERVER_URL?: string;
  /**
   * `http` makes the client poll instead of opening a socket. Needed on a
   * host with no long-lived process; anything else uses Socket.IO.
   */
  readonly VITE_TRANSPORT?: 'http' | 'socket';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
