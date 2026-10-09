// The events log is a JSON-lines file, imported as text (`with { type: 'text' }`, supported by the
// bundler) and parsed by the standard's loader.
declare module '*.jsonl' {
  const text: string;
  export default text;
}
