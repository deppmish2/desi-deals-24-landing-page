Implement the **Figma design directly in code** while preserving complete functional parity with the existing application.

1. **Do not change any existing business logic, API calls, data contracts, routing logic, authentication logic, or state transitions.**

2. **UI updates must remain purely presentational** unless a missing interaction is explicitly defined in the Figma design.

3. If any UI change risks functional behavior, **use a wrapper or adapter layer instead of modifying existing logic.**

4. **Do not modify backend integrations or request response formats.** Any data transformation required for the UI must happen in the presentation layer.

5. **Avoid side effects inside UI components.** Components should remain stateless where possible and receive data through props or view models.

6. **Existing event handlers and callbacks must remain unchanged.** UI components may call them but must not alter their behavior.

7. **Preserve current navigation flows and route behavior.** Layout changes must not affect routing, deep linking, or page lifecycle.

8. **Do not introduce new dependencies or architectural changes** unless strictly required for rendering the design and without impacting runtime behavior.

9. **Ensure compatibility with the current component structure and state management patterns.** The UI must integrate without forcing refactors in surrounding modules.

10. **Maintain accessibility and keyboard interaction support** for all existing interactive elements.

11. **Implement responsive behavior and ensure the design works correctly on mobile devices.**

12. **Do not remove or disable any existing feature or UI state** such as loading, error, empty, or success states unless explicitly replaced in the design.

13. **All UI changes must remain modular and reversible**, allowing the new UI layer to be rolled back without affecting application logic.
