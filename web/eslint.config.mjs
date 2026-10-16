import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

// Next 16 ships eslint-plugin-react-hooks v7, whose React-Compiler rules flag
// pre-existing (React 18) patterns. They are optimisation advisories, not security or
// correctness rules, so they stay visible as warnings; all other rules keep their severity.
const compilerAdvisories = [
  'react-hooks/set-state-in-effect',
  'react-hooks/static-components',
  'react-hooks/purity',
  'react-hooks/refs',
  'react-hooks/immutability',
  'react-hooks/preserve-manual-memoization',
]

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  { rules: Object.fromEntries(compilerAdvisories.map((r) => [r, 'warn'])) },
]
export default config
