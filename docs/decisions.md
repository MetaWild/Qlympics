# Architectural Decisions

This document records irreversible or foundational decisions in Qlympics.

---

## D-001: Off-chain gameplay, on-chain settlement

**Decision**  
Real-time gameplay state is kept off-chain; only rewards are settled on-chain.

**Why**
- Real-time movement and coin spawning require millisecond updates
- On-chain execution would be slow and expensive
- On-chain settlement preserves trust and auditability

**Consequences**
- Game server is authoritative during matches
- Final results must be persisted and verifiable

---

## D-002: TypeScript across Web, API, and Game Server

**Decision**  
All services use TypeScript/Node.js.

**Why**
- Quai SDK is strongest in JS/TS
- Shared types reduce integration errors
- Faster iteration for agent-first development

**Consequences**
- Solidity is isolated to contracts only
- Performance handled via Redis + efficient tick loops

---

## D-003: Postgres for durability, Redis for real-time state

**Decision**  
Use Postgres for durable data and Redis for hot state.

**Why**
- Relational integrity needed for agents, lobbies, payouts
- Redis enables fast state mutation and pub/sub

**Consequences**
- Clear separation of concerns
- Requires coordination between DB and game server

---

## D-004: Lobbies as the scaling primitive

**Decision**  
Each game mode is composed of multiple independent lobbies.

**Why**
- Natural sharding for scale
- Enables live viewing per lobby
- Simplifies matchmaking and isolation

**Consequences**
- Must manage lobby lifecycle carefully
- Requires lobby discovery and watch codes

---

## D-005: PoW-based agent verification + API key identity

**Decision**  
Agents complete a server-issued proof-of-work challenge to register and receive an API key, which becomes their identity.

**Why**
- Reduces casual human spam without requiring wallets or signatures
- Keeps onboarding simple for bots (store API key once)
- Requires payout addresses without coupling identity to wallets

**Consequences**
- PoW is an anti-spam gate, not a strong bot guarantee
- API key lifecycle management is required

---

## D-006: WebSockets for Watch Live

**Decision**  
Live viewing uses WebSockets.

**Why**
- Low-latency updates
- Efficient fan-out to many viewers
- Natural fit for lobby-based events

**Consequences**
- Event schemas must be versioned
- Backpressure and rate limits required at scale

---

## D-007: Orchard testnet for development, mainnet for production

**Decision**  
Development uses Orchard testnet; production uses Quai mainnet (Cyprus-1 zone).

**Why**
- Enables safe iteration with test funds
- Aligns with Quai SDK and RPC support

**Consequences**
- API and game server must be network-configurable
- Providers must set `usePathing: true` for Quai RPCs

---

## D-008: Bot verification via PoW + API key + heartbeat

**Decision**  
An agent is considered a bot only after completing a PoW challenge, receiving an API key, and sending periodic heartbeats.

**Why**
- Distinguishes onboarding from active agent runtime
- Supports liveness and anti-spoofing controls

**Consequences**
- API key lifecycle management is required
- Agents missing heartbeats are marked inactive

---

## D-009: Lobbies start only when full

**Decision**  
Lobbies wait until max players are reached before starting.

**Why**
- Ensures fair, synchronized starts
- Simplifies pacing for coin spawn distribution

**Consequences**
- Queue time is possible during low traffic
- New lobbies are created when capacity is reached

---

## D-010: 6-character watch codes

**Decision**  
Each lobby has a unique 6-character alphanumeric watch code for Watch Live.

**Why**
- Fast manual entry for users and agents
- Avoids exposing internal IDs

**Consequences**
- Watch code uniqueness must be enforced in Postgres
- Watch code format and length are standardized

---

## D-011: Use Quai media kit assets and fonts

**Decision**  
UI uses official Quai logos and typography (Yapari, Monorama, Bai Jamjuree).

**Why**
- Keeps branding consistent with Quai Network
- Matches the arcade red + monotone palette

**Consequences**
- Assets live under `assets/brand/`
- Web build must bundle font files

---

## D-012: Treasury-wallet payouts via Quais SDK

**Decision**  
Payouts are sent from a server-managed treasury wallet on the Quai ledger using the Quais SDK (no smart contracts in v1).

**Why**
- Simplifies launch and reduces contract risk
- Supports fast iteration on game economics

**Consequences**
- Treasury key management is critical
- Payouts must be auditable and logged
- Payouts are distributed proportional to coins collected; uncollected coins are not paid out

---

## D-013: Cached Quai-USD price feed

**Decision**  
USD conversions use a cached price feed stored in the database.

**Why**
- Stable UI stats without spamming external APIs
- Auditable historical price used for reporting

**Consequences**
- Price sampling interval must be configured
- Stats endpoint returns cached values
