export function errorToJson(error: string | Error): Error | undefined {
  if (typeof error === 'string') {
    return { message: error } as Error;
  }

  if (error instanceof Error) {
    let jsonError: Error = {
      message: error.message,
      stack: error.stack,
      name: error.name
    };
    // Add all custom codeFrame properties
    (Object.keys(error) as Array<keyof Error>).forEach(key => {
      jsonError[key] = error[key];
    });
    return jsonError;
  }
}

export function jsonToError(json: Error): Error | undefined {
  if (json) {
    let error = new Error(json.message);
    (Object.keys(error) as Array<keyof Error>).forEach(key => {
      error[key] = json[key];
    });
    return error;
  }
}
