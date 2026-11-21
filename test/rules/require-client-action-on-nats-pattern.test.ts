import * as path from 'node:path';
import { RuleTester } from 'oxlint/plugins-dev';

import { requireClientActionOnNatsPattern } from '../../src/rules/require-client-action-on-nats-pattern.js';

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures');
const filename = path.join(fixturesDir, 'require-client-action-on-nats-pattern.ts');

const ruleTester = new RuleTester();

const DECORATOR_DECLS = `
  declare function MessagePattern(pattern: unknown): MethodDecorator;
  declare function EventPattern(pattern: unknown): MethodDecorator;
  declare function SubscribeMessage(event: string): MethodDecorator;
`;

const ENUM_DECLS = `
  declare const AuthClientAction: { LOGIN: string };
  declare const SeoIndexClientAction: { JOB_POST_CREATED: string };
  declare const SomeEnum: { LOGIN: string };
  declare namespace Foo {
    const AuthClientAction: { LOGIN: string };
  }
  declare type ActionType = string;
`;

const ABSTRACT_BASE_DECL = `
  declare abstract class AbstractClientService {
    protected send<R>(pattern: unknown, data: unknown): Promise<R>;
    protected emit(pattern: unknown, data: unknown): void;
  }
`;

ruleTester.run(
  'require-client-action-on-nats-pattern',
  requireClientActionOnNatsPattern,
  {
    valid: [
      {
        name: 'valid: @MessagePattern with *ClientAction member access',
        filename,
        code: `
          ${DECORATOR_DECLS}
          ${ENUM_DECLS}
          class AuthNatsController {
            @MessagePattern(AuthClientAction.LOGIN)
            handle() {}
          }
        `,
      },
      {
        name: 'valid: @EventPattern with *ClientAction member access',
        filename,
        code: `
          ${DECORATOR_DECLS}
          ${ENUM_DECLS}
          class SeoNatsController {
            @EventPattern(SeoIndexClientAction.JOB_POST_CREATED)
            handle() {}
          }
        `,
      },
      {
        name: 'valid: TS as-cast unwrapped',
        filename,
        code: `
          ${DECORATOR_DECLS}
          ${ENUM_DECLS}
          class C {
            @MessagePattern(AuthClientAction.LOGIN as ActionType)
            handle() {}
          }
        `,
      },
      {
        name: 'valid: TS non-null assertion unwrapped',
        filename,
        code: `
          ${DECORATOR_DECLS}
          ${ENUM_DECLS}
          class C {
            @MessagePattern(AuthClientAction.LOGIN!)
            handle() {}
          }
        `,
      },
      {
        name: 'valid: TS satisfies unwrapped',
        filename,
        code: `
          ${DECORATOR_DECLS}
          ${ENUM_DECLS}
          class C {
            @MessagePattern(AuthClientAction.LOGIN satisfies ActionType)
            handle() {}
          }
        `,
      },
      {
        name: 'valid: namespaced enum (Foo.AuthClientAction.LOGIN) - enum segment matches',
        filename,
        code: `
          ${DECORATOR_DECLS}
          ${ENUM_DECLS}
          class C {
            @MessagePattern(Foo.AuthClientAction.LOGIN)
            handle() {}
          }
        `,
      },
      {
        name: 'valid: this.send inside *ClientService extending AbstractClientService',
        filename,
        code: `
          ${ENUM_DECLS}
          ${ABSTRACT_BASE_DECL}
          class AuthClientService extends AbstractClientService {
            login(payload: unknown) {
              return this.send(AuthClientAction.LOGIN, payload);
            }
          }
        `,
      },
      {
        name: 'valid: this.emit inside *ClientService',
        filename,
        code: `
          ${ENUM_DECLS}
          ${ABSTRACT_BASE_DECL}
          class SeoClientService extends AbstractClientService {
            notifyCreated(payload: unknown) {
              this.emit(SeoIndexClientAction.JOB_POST_CREATED, payload);
            }
          }
        `,
      },
      {
        name: 'valid: super.send inside *ClientService',
        filename,
        code: `
          ${ENUM_DECLS}
          ${ABSTRACT_BASE_DECL}
          class AuthClientService extends AbstractClientService {
            login(payload: unknown) {
              return super.send(AuthClientAction.LOGIN, payload);
            }
          }
        `,
      },
      {
        name: 'valid: this.send inside AbstractClientService itself - excluded by class name',
        filename,
        code: `
          declare class ClientProxy {
            send(pattern: unknown, data: unknown): unknown;
          }
          class AbstractClientService {
            client!: ClientProxy;
            wrap(pattern: unknown, data: unknown) {
              return this.send(pattern, data);
            }
            send(pattern: unknown, data: unknown) {
              return this.client.send(pattern, data);
            }
          }
        `,
      },
      {
        name: 'valid: this.emit on a non-*ClientService class is not flagged',
        filename,
        code: `
          class NotificationGateway {
            emit(pattern: string, data: unknown) {
              return { pattern, data };
            }
            handle() {
              this.emit('socket-event', { foo: 1 });
            }
          }
        `,
      },
      {
        name: 'valid: external receiver send/emit (socket.emit, bot.send) is not flagged',
        filename,
        code: `
          declare const socket: { emit(event: string, data: unknown): void };
          declare const bot: { send(chat: string, data: unknown): void };
          ${ENUM_DECLS}
          ${ABSTRACT_BASE_DECL}
          class HostClientService extends AbstractClientService {
            run() {
              socket.emit('socket-event', { foo: 1 });
              bot.send('chat-id', { foo: 1 });
              return this.send(AuthClientAction.LOGIN, {});
            }
          }
        `,
      },
      {
        name: 'valid: unrelated decorator @SubscribeMessage is not flagged',
        filename,
        code: `
          ${DECORATOR_DECLS}
          class Gateway {
            @SubscribeMessage('event')
            handle() {}
          }
        `,
      },
      {
        name: 'valid: zero-arg @MessagePattern is silently skipped (TS will catch)',
        filename,
        code: `
          declare function MessagePattern(...args: unknown[]): MethodDecorator;
          class C {
            @MessagePattern()
            handle() {}
          }
        `,
      },
      {
        name: 'valid: this.send outside any class is not flagged (no enclosing class)',
        filename,
        code: `
          ${ENUM_DECLS}
          declare const that: { send: (p: unknown, d: unknown) => void };
          that.send('something', {});
        `,
      },
    ],

    invalid: [
      {
        name: 'invalid: @MessagePattern with string literal',
        filename,
        code: `
          ${DECORATOR_DECLS}
          class C {
            @MessagePattern('auth.login')
            handle() {}
          }
        `,
        errors: [
          {
            messageId: 'notMemberExpression',
            data: { site: '@MessagePattern', nodeType: 'Literal' },
          },
        ],
      },
      {
        name: 'invalid: @MessagePattern with template literal',
        filename,
        code: `
          ${DECORATOR_DECLS}
          declare const kind: string;
          class C {
            @MessagePattern(\`auth.\${kind}\`)
            handle() {}
          }
        `,
        errors: [
          {
            messageId: 'notMemberExpression',
            data: { site: '@MessagePattern', nodeType: 'TemplateLiteral' },
          },
        ],
      },
      {
        name: 'invalid: @MessagePattern with bare identifier (variable rebind)',
        filename,
        code: `
          ${DECORATOR_DECLS}
          ${ENUM_DECLS}
          const action = AuthClientAction.LOGIN;
          class C {
            @MessagePattern(action)
            handle() {}
          }
        `,
        errors: [
          {
            messageId: 'notMemberExpression',
            data: { site: '@MessagePattern', nodeType: 'Identifier' },
          },
        ],
      },
      {
        name: 'invalid: @MessagePattern with function call',
        filename,
        code: `
          ${DECORATOR_DECLS}
          declare function getPattern(): string;
          class C {
            @MessagePattern(getPattern())
            handle() {}
          }
        `,
        errors: [
          {
            messageId: 'notMemberExpression',
            data: { site: '@MessagePattern', nodeType: 'CallExpression' },
          },
        ],
      },
      {
        name: 'invalid: @MessagePattern with object literal',
        filename,
        code: `
          ${DECORATOR_DECLS}
          class C {
            @MessagePattern({ cmd: 'auth.login' })
            handle() {}
          }
        `,
        errors: [
          {
            messageId: 'notMemberExpression',
            data: { site: '@MessagePattern', nodeType: 'ObjectExpression' },
          },
        ],
      },
      {
        name: 'invalid: @MessagePattern with computed enum access',
        filename,
        code: `
          ${DECORATOR_DECLS}
          ${ENUM_DECLS}
          class C {
            @MessagePattern(AuthClientAction['LOGIN'])
            handle() {}
          }
        `,
        errors: [
          {
            messageId: 'computedAccess',
            data: { site: '@MessagePattern' },
          },
        ],
      },
      {
        name: 'invalid: @MessagePattern with wrong enum suffix',
        filename,
        code: `
          ${DECORATOR_DECLS}
          ${ENUM_DECLS}
          class C {
            @MessagePattern(SomeEnum.LOGIN)
            handle() {}
          }
        `,
        errors: [
          {
            messageId: 'wrongEnumSuffix',
            data: { site: '@MessagePattern', rootName: 'SomeEnum' },
          },
        ],
      },
      {
        name: 'invalid: @EventPattern with string literal',
        filename,
        code: `
          ${DECORATOR_DECLS}
          class C {
            @EventPattern('post.created')
            handle() {}
          }
        `,
        errors: [
          {
            messageId: 'notMemberExpression',
            data: { site: '@EventPattern', nodeType: 'Literal' },
          },
        ],
      },
      {
        name: 'invalid: this.send with string literal inside *ClientService',
        filename,
        code: `
          ${ABSTRACT_BASE_DECL}
          class AuthClientService extends AbstractClientService {
            login(payload: unknown) {
              return this.send('auth.login', payload);
            }
          }
        `,
        errors: [
          {
            messageId: 'notMemberExpression',
            data: { site: 'this.send(...)', nodeType: 'Literal' },
          },
        ],
      },
      {
        name: 'invalid: this.emit with string literal inside *ClientService',
        filename,
        code: `
          ${ABSTRACT_BASE_DECL}
          class SeoClientService extends AbstractClientService {
            run(payload: unknown) {
              this.emit('post.created', payload);
            }
          }
        `,
        errors: [
          {
            messageId: 'notMemberExpression',
            data: { site: 'this.emit(...)', nodeType: 'Literal' },
          },
        ],
      },
      {
        name: 'invalid: this.send with function-call pattern',
        filename,
        code: `
          ${ABSTRACT_BASE_DECL}
          declare function getPattern(): string;
          class AuthClientService extends AbstractClientService {
            login(payload: unknown) {
              return this.send(getPattern(), payload);
            }
          }
        `,
        errors: [
          {
            messageId: 'notMemberExpression',
            data: { site: 'this.send(...)', nodeType: 'CallExpression' },
          },
        ],
      },
      {
        name: 'invalid: this.send with wrong enum suffix',
        filename,
        code: `
          ${ENUM_DECLS}
          ${ABSTRACT_BASE_DECL}
          class AuthClientService extends AbstractClientService {
            login(payload: unknown) {
              return this.send(SomeEnum.LOGIN, payload);
            }
          }
        `,
        errors: [
          {
            messageId: 'wrongEnumSuffix',
            data: { site: 'this.send(...)', rootName: 'SomeEnum' },
          },
        ],
      },
      {
        name: 'invalid: this.send with computed access',
        filename,
        code: `
          ${ENUM_DECLS}
          ${ABSTRACT_BASE_DECL}
          class AuthClientService extends AbstractClientService {
            login(payload: unknown) {
              return this.send(AuthClientAction['LOGIN'], payload);
            }
          }
        `,
        errors: [
          {
            messageId: 'computedAccess',
            data: { site: 'this.send(...)' },
          },
        ],
      },
      {
        name: 'invalid: super.emit with string literal inside *ClientService',
        filename,
        code: `
          ${ABSTRACT_BASE_DECL}
          class SeoClientService extends AbstractClientService {
            run(payload: unknown) {
              super.emit('event', payload);
            }
          }
        `,
        errors: [
          {
            messageId: 'notMemberExpression',
            data: { site: 'this.emit(...)', nodeType: 'Literal' },
          },
        ],
      },
    ],
  },
);
