# Smink game engine

NestJS monorepo. The browser talks to **one** HTTP process: the gateway.
Everything else is internal.

```
Dashboard  --HTTP+cookie-->  Gateway :4100
                               |
                               | RabbitMQ RPC  (smink.engine.rpc)
                               v
                             Engine
                               |
                               | after Postgres commit
                               |  • topic events  smink.events
                               |  • BullMQ jobs   smink.realtime / smink.session
                               v
                             Worker  --> Ably + Redis session history
```

Play is refused unless the player currently holds an Ably connection
(presence on `smink:user:{id}`). The dashboard header shows that status.

## Run locally

```bash
cp .env.example .env          # JWT_SECRET must match frontend/smink
pnpm install
pnpm infra:up                 # Redis :6380, RabbitMQ :5672 / :15672
pnpm db:migrate
pnpm db:seed

pnpm start:dev                # gateway + engine + worker, one terminal
```

Or one service at a time (this is also what you deploy):

```bash
pnpm start:gateway            # HTTP :4100
pnpm start:engine             # RabbitMQ RPC
pnpm start:worker             # BullMQ + Ably fan-out

pnpm build:gateway && pnpm start:gateway:prod
pnpm build:engine  && pnpm start:engine:prod
pnpm build:worker  && pnpm start:worker:prod
```

`ABLY_API_KEY` is required for play. Tokens are issued by
`POST /v1/realtime/token`; the API key never goes to the browser.

## Why money is not on a queue

A bet is a Postgres transaction: debit, roll, persist, credit. That happens
inside the engine, on the RPC reply path. RabbitMQ events and BullMQ jobs
run **after** commit. If Ably is down, the player still got the HTTP result;
the ticker just lags.

## Gateway surface

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/health` | public |
| POST | `/v1/realtime/token` | Ably token, JWT required |
| POST | `/v1/sessions` | wait-room → play session; requires Ably presence |
| GET | `/v1/sessions/:id` | session + this-session history |
| POST | `/v1/sessions/:id/end` | |
| POST | `/v1/play` | instant games; requires presence |
| POST | `/v1/mines/start` `reveal` `cashout` | requires presence |

## Apps

- `apps/gateway` — only public HTTP server
- `apps/engine` — RabbitMQ microservice, owns settlement
- `apps/worker` — BullMQ + event consumer, owns Ably fan-out
