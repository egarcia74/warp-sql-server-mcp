import { createConfigOutput } from './config-output.js';
/** The dependency is imported only after the editor verifies both terminal streams. */
export async function createPromptAdapter({
  input = process.stdin,
  output = process.stdout,
  signal,
  renderer = createConfigOutput()
} = {}) {
  const library = await import('@inquirer/prompts');
  const wasFlowing = input.readableFlowing;
  const wasRaw = !!input.isRaw;
  const context = options => ({
    input,
    output,
    signal: options.signal || signal,
    clearPromptOnDone: true
  });
  const message = options => renderer.safe(options.message);
  return {
    dispose: () => {
      input.setRawMode?.(wasRaw);
      if (wasFlowing !== true) input.pause?.();
    },
    select: options =>
      library.select(
        {
          message: message(options),
          choices: options.choices.map(c =>
            typeof c === 'string'
              ? renderer.safe(c)
              : {
                  ...c,
                  name: renderer.safe(c.name),
                  ...(c.description ? { description: renderer.safe(c.description) } : {})
                }
          )
        },
        context(options)
      ),
    input: options =>
      library.input(
        {
          message: message(options),
          ...(options.defaultValue !== undefined
            ? { default: renderer.safe(options.defaultValue) }
            : {}),
          validate: options.validate
        },
        context(options)
      ),
    confirm: options =>
      library.confirm(
        { message: message(options), default: options.defaultValue ?? false },
        context(options)
      ),
    password: options =>
      library.password(
        { message: message(options), mask: false, validate: options.validate },
        context(options)
      )
  };
}
