const serverErrorList: { [key: string]: string } = {
    EACCES: "You don't have access to bind the server to port {port}.",
    EADDRINUSE: 'There is already a process listening on port {port}.'
};

export function serverErrors(err: Error, port: number) {
    let desc = `Error: ${
        (err as any).code
    } occurred while setting up server on port ${port}.`;

    if (serverErrorList[(err as any).code]) {
        desc = serverErrorList[(err as any).code].replace(/{port}/g, port.toString());
    }

    return desc;
}
