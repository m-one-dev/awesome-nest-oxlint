// Stand-ins for the NestJS and Swagger decorators the controllers beside this file use.
export function Controller(_path?: string): ClassDecorator {
  return () => {};
}

export function Get(_path?: string): MethodDecorator {
  return () => {};
}

export function Post(_path?: string): MethodDecorator {
  return () => {};
}

export function Body(_field?: string): ParameterDecorator {
  return () => {};
}

export function ApiOkResponse(_options?: unknown): MethodDecorator {
  return () => {};
}
