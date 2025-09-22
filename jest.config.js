/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest', // Questo è il punto chiave
  testEnvironment: 'node',
  // Se hai bisogno di altri percorsi
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
};