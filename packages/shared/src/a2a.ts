import { v4 as uuidv4 } from 'uuid';
import { A2AMessage, A2AMessageType, AgentName, AGENT_PORTS } from './types';
import { createLogger } from './logger';

const logger = createLogger();

export class A2AClient {
  private agentName: AgentName;
  private baseUrls: Record<AgentName, string>;

  constructor(agentName: AgentName, overrideUrls?: Partial<Record<AgentName, string>>) {
    this.agentName = agentName;
    this.baseUrls = Object.entries(AGENT_PORTS).reduce((acc, [name, port]) => {
      const host = process.env[`${name}_HOST`] || 'localhost';
      acc[name as AgentName] = overrideUrls?.[name as AgentName] || `http://${host}:${port}`;
      return acc;
    }, {} as Record<AgentName, string>);
  }

  createMessage(
    toAgent: AgentName | 'BROADCAST',
    messageType: A2AMessageType,
    correlationId: string,
    payload: unknown
  ): A2AMessage {
    return {
      id: uuidv4(),
      protocol: 'A2A/1.0',
      timestamp: new Date().toISOString(),
      correlationId,
      fromAgent: this.agentName,
      toAgent,
      messageType,
      payload,
    };
  }

  async send(
    toAgent: AgentName,
    messageType: A2AMessageType,
    correlationId: string,
    payload: unknown,
    timeoutMs = 60000
  ): Promise<A2AMessage> {
    const message = this.createMessage(toAgent, messageType, correlationId, payload);
    const url = `${this.baseUrls[toAgent]}/a2a/receive`;

    logger.info(`A2A → ${toAgent}`, { messageId: message.id, type: messageType, correlationId });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-A2A-Protocol': 'A2A/1.0',
          'X-A2A-From': this.agentName,
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`A2A request failed: ${response.status} ${response.statusText}`);
      }

      const reply = await response.json() as A2AMessage;
      logger.info(`A2A ← ${toAgent}`, { messageId: reply.id, type: reply.messageType });
      return reply;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`A2A timeout after ${timeoutMs}ms sending to ${toAgent}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendParallel(
    targets: AgentName[],
    messageType: A2AMessageType,
    correlationId: string,
    payloads: Record<AgentName, unknown>,
    timeoutMs = 60000
  ): Promise<Record<AgentName, A2AMessage | Error>> {
    const promises = targets.map(async (agent) => {
      try {
        const result = await this.send(agent, messageType, correlationId, payloads[agent], timeoutMs);
        return [agent, result] as const;
      } catch (err) {
        return [agent, err instanceof Error ? err : new Error(String(err))] as const;
      }
    });

    const results = await Promise.allSettled(promises);
    const output: Record<AgentName, A2AMessage | Error> = {} as any;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const [agent, value] = result.value;
        output[agent] = value;
      }
    }

    return output;
  }

  getUrl(agent: AgentName): string {
    return this.baseUrls[agent];
  }
}

// SSE event emitter for real-time log streaming
export class SSEEmitter {
  private clients: Set<(data: string) => void> = new Set();

  addClient(cb: (data: string) => void) {
    this.clients.add(cb);
    return () => this.clients.delete(cb);
  }

  emit(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.clients.forEach(cb => cb(payload));
  }

  get clientCount() {
    return this.clients.size;
  }
}

export const globalSSE = new SSEEmitter();
