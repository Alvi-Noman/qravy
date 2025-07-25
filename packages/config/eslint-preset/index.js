import base from './base.js';
import react from './react.js';
import node from './node.js';

export default [
  ...base,
  ...react,
  ...node,
  {
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
    },
  },
];