# Messaging — Implementation Test

Implement the HTTP APIs described in [`auth-interface.md`](auth-interface.md) and [`user-interface.md`](user-interface.md). This is a timed exercise: use AI to help you finish the implementation in the time window. Any tech stack is fine.

## What to build

**Auth** (`auth-interface.md`): registration, login, refresh, logout, password reset, email verification, MFA, profile updates, devices/sessions, and blocked users.

**Users, contacts, and invites** (`user-interface.md`): public user profiles, user search, contact list management, and invite create/list/accept/decline/lookup. All endpoints require a valid bearer token from the auth API.

## Quick check

With your server running (`http://127.0.0.1:3000`), run the preliminary functional suites:

```bash
node auth-functional-test.mjs
node user-functional-test.mjs
```

`auth-functional-test.mjs` covers core auth flows. `user-functional-test.mjs` exercises `/users`, `/contacts`, and `/invites` per `user-interface.md` (it registers fixture users via `/auth/register` first).

Passing these tests does not guarantee a complete solution. Read both specs for edge cases and concurrency rules.

## How you will be evaluated

| Dimension | What we look for |
|-----------|------------------|
| **Functional correctness** | Behavior matches `auth-interface.md` and `user-interface.md` (status codes, response shapes, flows, idempotency, token rotation, anti-enumeration, pagination, invite side effects, etc.). Your implementation should cover **edge cases** and resist **race conditions** |
| **Scalability** | Sensible data model and API design for low latency and high throughput. |
| **Security** | Safe auth practices (token handling, replay protection, input validation, redirect allow-list rules, no leakage of secrets in public profiles or responses). |
