export async function devtoolsStaticServer() {
  throw new Error("Skybridge devtools are not available on the worker.");
}

export async function createServer() {
  throw new Error("Vite is not available on the worker.");
}

export async function loadConfigFromFile() {
  return null;
}
