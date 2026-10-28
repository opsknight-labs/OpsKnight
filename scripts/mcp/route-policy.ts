import ts from 'typescript';
import {
  AUTHORIZATION_ACTIONS,
  type AuthorizationAction,
} from '../../src/lib/authorization-policy';

/** Read mandatory route gates, excluding authorize() probes used to describe available actions. */
export function declaredRouteActions(source: string, method: string): AuthorizationAction[] {
  const file = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  const collect = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.getText(file) === 'AUTHORIZATION_ACTIONS'
    )
      names.add(node.name.text);
    ts.forEachChild(node, collect);
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ['enforceV2Authorization', 'enforceV2ResourceAuthorization'].includes(
        node.expression.getText(file)
      )
    )
      collect(node);
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(file) === 'action' &&
      ts.isObjectLiteralExpression(node.parent) &&
      ts.isCallExpression(node.parent.parent) &&
      node.parent.parent.expression.getText(file) === 'defineV2Route'
    )
      collect(node.initializer);
    ts.forEachChild(node, visit);
  };
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === method) visit(statement);
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === method)
          visit(declaration);
      }
  }
  const actions = new Map(Object.entries(AUTHORIZATION_ACTIONS));
  return [...names]
    .map(name => {
      const action = actions.get(name);
      if (!action) throw new Error(`Unknown canonical action ${name}`);
      return action;
    })
    .sort();
}
