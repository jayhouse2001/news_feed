import { handler, json, currentUser } from '../../_lib/util.js';

export const onRequestGet = handler(async ({ request, env }) => {
  const user = await currentUser(env, request);
  return json(user ? { signedIn: true, email: user.email } : { signedIn: false });
});
