interface SolverExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  ga_input(length: number): number;
  ga_execute(): number;
  ga_output_len(): number;
}
/** Minimal versioned JSON ABI; all optimization runs in the packaged Rust binary. */
export async function instantiateSolver(bytes: BufferSource) {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const api = instance.exports as SolverExports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return (command: unknown) => {
    const input = encoder.encode(JSON.stringify(command));
    const address = api.ga_input(input.length);
    new Uint8Array(api.memory.buffer, address, input.length).set(input);
    const output = api.ga_execute();
    const response = JSON.parse(
      decoder.decode(
        new Uint8Array(api.memory.buffer, output, api.ga_output_len()),
      ),
    );
    if (response.error) throw Error(response.error);
    return response.ok;
  };
}
