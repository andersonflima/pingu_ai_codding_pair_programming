'use strict';

function createUiSnippetGenerator(helpers = {}) {
  const {
    isReactLikeExtension,
    generateGenericSnippet,
    decorateGeneratedSnippet,
    inferModuleStyle,
    jsDependencySpec,
  } = helpers;

  function generateUiSnippet(instruction, ext, lines = []) {
    if (isReactLikeExtension(ext)) {
      return generateReactUiSnippet(instruction, ext, lines);
    }
    return generateGenericSnippet(instruction, ext);
  }

  function generateReactUiSnippet(instruction, ext, lines = []) {
    const lowerInstruction = String(instruction || '').toLowerCase();
    const componentName = inferReactComponentName(lowerInstruction);
    const style = inferModuleStyle(ext, lines);

    if (isReactDiceInstruction(lowerInstruction)) {
      return decorateGeneratedSnippet({
        snippet: buildReactDiceSnippet(componentName, lowerInstruction),
        dependencies: [jsDependencySpec('named', 'useState', 'react', style)],
      }, componentName, [], instruction, ext);
    }

    if (/\blogin\b/.test(lowerInstruction)) {
      return decorateGeneratedSnippet({
        snippet: [
          `export function ${componentName}() {`,
          '  const [form, setForm] = useState({ email: "", password: "" });',
          '  const [isSubmitting, setIsSubmitting] = useState(false);',
          '',
          '  function handleChange(event) {',
          '    const { name, value } = event.target;',
          '    setForm((current) => ({ ...current, [name]: value }));',
          '  }',
          '',
          '  function handleSubmit(event) {',
          '    event.preventDefault();',
          '    setIsSubmitting(true);',
          '  }',
          '',
          '  return (',
          '    <main className="login-screen">',
          '      <section className="login-card">',
          '        <header className="login-card__header">',
          '          <p className="login-card__eyebrow">Acesso seguro</p>',
          '          <h1>Entrar na plataforma</h1>',
          '          <p>Use seu e-mail corporativo e senha para continuar.</p>',
          '        </header>',
          '',
          '        <form className="login-form" onSubmit={handleSubmit}>',
          '          <label className="login-form__field" htmlFor="email">',
          '            <span>E-mail</span>',
          '            <input',
          '              id="email"',
          '              name="email"',
          '              type="email"',
          '              autoComplete="email"',
          '              value={form.email}',
          '              onChange={handleChange}',
          '              placeholder="voce@empresa.com"',
          '              required',
          '            />',
          '          </label>',
          '',
          '          <label className="login-form__field" htmlFor="password">',
          '            <span>Senha</span>',
          '            <input',
          '              id="password"',
          '              name="password"',
          '              type="password"',
          '              autoComplete="current-password"',
          '              value={form.password}',
          '              onChange={handleChange}',
          '              placeholder="Digite sua senha"',
          '              required',
          '            />',
          '          </label>',
          '',
          '          <button className="login-form__submit" type="submit" disabled={isSubmitting}>',
          '            {isSubmitting ? "Entrando..." : "Entrar"}',
          '          </button>',
          '        </form>',
          '      </section>',
          '    </main>',
          '  );',
          '}',
        ].join('\n'),
        dependencies: [jsDependencySpec('named', 'useState', 'react', style)],
      }, componentName, [], instruction, ext);
    }

    return decorateGeneratedSnippet({
      snippet: [
        `export function ${componentName}() {`,
        '  return (',
        '    <section>',
        `      <h1>${safeJsxText(instruction)}</h1>`,
        '    </section>',
        '  );',
        '}',
      ].join('\n'),
      dependencies: [],
    }, componentName, [], instruction, ext);
  }

  return generateUiSnippet;
}

function inferReactComponentName(instruction) {
  if (isReactDiceInstruction(instruction)) {
    const sides = inferDiceSides(instruction);
    return sides > 0 ? `D${sides}DiceRoller` : 'DiceRoller';
  }
  if (/\blogin\b/.test(instruction)) {
    return 'LoginScreen';
  }
  if (/\bdashboard\b/.test(instruction)) {
    return 'DashboardScreen';
  }
  if (/\bmodal\b/.test(instruction)) {
    return 'ModalView';
  }
  return 'GeneratedScreen';
}

function safeJsxText(value) {
  return String(value || '').replace(/[{}]/g, '').trim();
}

function isReactDiceInstruction(instruction) {
  const text = String(instruction || '').toLowerCase();
  return /\b(dado|dice|rpg)\b/.test(text) && /\b(girar|gire|rola|rolar|clique|clicar|random|aleatorio|aleatório|lado|lados|d\d+)\b/.test(text);
}

function inferDiceSides(instruction) {
  const text = String(instruction || '').toLowerCase();
  const diceNotation = text.match(/\bd(\d+)\b/);
  if (diceNotation && diceNotation[1]) {
    return Number(diceNotation[1]);
  }

  const sideCount = text.match(/\b(\d+)\s*lados?\b/);
  if (sideCount && sideCount[1]) {
    return Number(sideCount[1]);
  }

  if (/\brpg\b/.test(text)) {
    return 20;
  }

  return 0;
}

function buildReactDiceSnippet(componentName, instruction) {
  const sides = inferDiceSides(instruction) || 20;
  const dieLabel = sides === 20 ? 'd20' : `d${sides}`;
  const title = sides === 20 ? 'Dado de 20 lados' : `Dado de ${sides} lados`;

  return [
    `export function ${componentName}() {`,
    `  const sides = ${sides};`,
    `  const [faceValue, setFaceValue] = useState(sides);`,
    '  const [rotation, setRotation] = useState({ x: -28, y: 34 });',
    '  const [isRolling, setIsRolling] = useState(false);',
    '',
    '  function handleRoll() {',
    '    if (isRolling) {',
    '      return;',
    '    }',
    '',
    '    const nextValue = Math.floor(Math.random() * sides) + 1;',
    '    setIsRolling(true);',
    '    setFaceValue(nextValue);',
    '    setRotation((current) => ({',
    '      x: current.x + 720 + nextValue * 11,',
      '      y: current.y + 900 + nextValue * 17,',
    '    }));',
    '',
    '    setTimeout(() => {',
    '      setIsRolling(false);',
    '    }, 900);',
    '  }',
    '',
    '  const dieTransform = `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`;',
    '',
    '  return (',
    '    <section',
    '      style={{',
    '        minHeight: "100vh",',
    '        display: "grid",',
    '        placeItems: "center",',
    '        padding: "2rem",',
    '        background: "radial-gradient(circle at top, #1f2a44 0%, #09090f 55%, #050508 100%)",',
    '        color: "#f8fafc",',
    '      }}',
    '    >',
    '      <div',
    '        style={{',
    '          width: "min(960px, 100%)",',
    '          display: "grid",',
    '          gap: "2rem",',
    '          alignItems: "center",',
    '          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",',
    '        }}',
    '      >',
    '        <div style={{ display: "grid", placeItems: "center", perspective: "1400px" }}>',
    '          <button',
    '            type="button"',
    '            onClick={handleRoll}',
    '            disabled={isRolling}',
    '            style={{',
    '              border: "none",',
    '              background: "transparent",',
    '              cursor: isRolling ? "progress" : "pointer",',
    '              padding: 0,',
    '            }}',
    '          >',
    '            <div',
    '              style={{',
    '                width: "220px",',
    '                aspectRatio: "1 / 1",',
    '                borderRadius: "28px",',
    '                display: "grid",',
    '                placeItems: "center",',
    '                background: "linear-gradient(145deg, #312e81 0%, #1d4ed8 45%, #0f172a 100%)",',
    '                boxShadow: "0 30px 70px rgba(15, 23, 42, 0.55)",',
    '                transform: dieTransform,',
    '                transformStyle: "preserve-3d",',
    '                transition: "transform 900ms cubic-bezier(0.2, 0.8, 0.2, 1)",',
    '              }}',
    '            >',
    `              <span style={{ position: "absolute", top: "1rem", left: "1rem", fontSize: "0.8rem", letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.75 }}>{${JSON.stringify(dieLabel.toUpperCase())}}</span>`,
    '              <strong style={{ fontSize: "4.5rem", lineHeight: 1, fontWeight: 800 }}>{faceValue}</strong>',
    '              <span style={{ position: "absolute", bottom: "1rem", fontSize: "0.95rem", opacity: 0.78 }}>',
    '                {isRolling ? "Girando..." : "Clique para rolar"}',
    '              </span>',
    '            </div>',
    '          </button>',
    '        </div>',
    '',
    '        <article',
    '          style={{',
    '            padding: "2rem",',
    '            borderRadius: "28px",',
    '            background: "rgba(15, 23, 42, 0.72)",',
    '            border: "1px solid rgba(148, 163, 184, 0.18)",',
    '            backdropFilter: "blur(18px)",',
    '          }}',
    '        >',
    '          <p style={{ margin: 0, fontSize: "0.8rem", letterSpacing: "0.22em", textTransform: "uppercase", color: "#38bdf8" }}>',
    '            mesa de rpg',
    '          </p>',
    `          <h1 style={{ margin: "0.75rem 0 0", fontSize: "clamp(2rem, 5vw, 3.6rem)", lineHeight: 1 }}>{${JSON.stringify(title)}}</h1>`,
    '          <p style={{ margin: "1rem 0 0", maxWidth: "34ch", fontSize: "1rem", lineHeight: 1.7, color: "#cbd5f5" }}>',
    '            Gire o dado ao clicar para sortear um numero aleatorio e destacar o resultado atual na tela.',
    '          </p>',
    '',
    '          <div',
    '            style={{',
    '              marginTop: "1.5rem",',
    '              display: "inline-flex",',
    '              flexDirection: "column",',
    '              gap: "0.35rem",',
    '              padding: "1rem 1.25rem",',
    '              borderRadius: "20px",',
    '              background: "rgba(15, 23, 42, 0.9)",',
    '              border: "1px solid rgba(96, 165, 250, 0.25)",',
    '            }}',
    '          >',
    '            <span style={{ fontSize: "0.78rem", letterSpacing: "0.16em", textTransform: "uppercase", color: "#7dd3fc" }}>',
    '              resultado atual',
    '            </span>',
    '            <strong style={{ fontSize: "3rem", lineHeight: 1 }}>{faceValue}</strong>',
    '          </div>',
    '        </article>',
    '      </div>',
    '    </section>',
    '  );',
    '}',
  ].join('\n');
}

module.exports = {
  createUiSnippetGenerator,
};
