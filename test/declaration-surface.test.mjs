import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

test('every public runtime export and declaration value stay synchronized', async () => {
  const packageRoot = fileURLToPath(new URL('../', import.meta.url));
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const entryPoints = Object.values(packageJson.exports).map(entry => ({
    declaration: path.resolve(packageRoot, entry.types),
    runtime: path.resolve(packageRoot, entry.import)
  }));
  const program = ts.createProgram(
    entryPoints.map(entry => entry.declaration),
    {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      skipLibCheck: true
    }
  );
  const checker = program.getTypeChecker();

  for (const entry of entryPoints) {
    const source = program.getSourceFile(entry.declaration);
    assert.ok(source, `TypeScript did not load ${entry.declaration}`);
    const moduleSymbol = checker.getSymbolAtLocation(source);
    assert.ok(moduleSymbol, `TypeScript did not resolve ${entry.declaration} as a module`);
    const declaredValues = checker.getExportsOfModule(moduleSymbol)
      .filter(symbol => {
        const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        return (target.flags & ts.SymbolFlags.Value) !== 0;
      })
      .map(symbol => symbol.name)
      .sort();
    const runtimeValues = Object.keys(await import(pathToFileURL(entry.runtime).href)).sort();
    assert.deepEqual(runtimeValues, declaredValues, `Runtime/declaration drift in ${path.basename(entry.runtime)}`);
  }
});
