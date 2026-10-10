/** Server-Sent Events hub: pushes "something changed" pings; clients then refetch their own role-scoped view. */
import type { Response } from "express";

type Audience = "all" | "staff";
interface Client { res: Response; role: "participant" | "host" | "screen"; participantId?: string }

export class EventHub {
  private clients = new Map<string, Set<Client>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private seq = 0;

  add(sessionId: string, client: Client) {
    if (!this.clients.has(sessionId)) this.clients.set(sessionId, new Set());
    this.clients.get(sessionId)!.add(client);
    client.res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    client.res.write(`retry: 3000\n\n`);
    const ping = setInterval(() => client.res.write(`: ping\n\n`), 15000);
    client.res.on("close", () => {
      clearInterval(ping);
      this.clients.get(sessionId)?.delete(client);
      if (client.role !== "host") this.notify(sessionId, "staff");
    });
    // Participants and projector windows connecting/disconnecting change what the dashboard shows.
    if (client.role !== "host") this.notify(sessionId, "staff");
  }

  /** Debounced per (session, audience) so a burst of answers produces one refresh. */
  notify(sessionId: string, audience: Audience = "all") {
    const k = `${sessionId}:${audience}`;
    if (this.timers.has(k)) return;
    this.timers.set(k, setTimeout(() => {
      this.timers.delete(k);
      const v = ++this.seq;
      for (const c of this.clients.get(sessionId) ?? []) {
        if (audience === "staff" && c.role === "participant") continue;
        c.res.write(`event: update\ndata: ${JSON.stringify({ v })}\n\n`);
      }
    }, audience === "all" ? 50 : 250));
  }

  /** Number of open live connections with a given role (e.g. projector windows showing this session). */
  count(sessionId: string, role: Client["role"]): number {
    let n = 0;
    for (const c of this.clients.get(sessionId) ?? []) if (c.role === role) n++;
    return n;
  }

  connectedParticipants(sessionId: string): Set<string> {
    const s = new Set<string>();
    for (const c of this.clients.get(sessionId) ?? []) if (c.participantId) s.add(c.participantId);
    return s;
  }

  closeSession(sessionId: string) {
    for (const c of this.clients.get(sessionId) ?? []) c.res.end();
    this.clients.delete(sessionId);
  }

  closeAll() {
    for (const id of [...this.clients.keys()]) this.closeSession(id);
    for (const t of this.timers.values()) clearTimeout(t);
  }
}
