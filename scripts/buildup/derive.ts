// The build-up's pure derivations moved into core (packages/core/src/server/onboarding-derive.ts), where the server's
// adopt job runs them; this file keeps the scripts' import path: onboard-live.ts and replay-tape.ts read them from here.
export { activityOf, areaOf, outlineFrom, provisionalHealth, surveyFrom, type AreaIndex } from '@bp/core/server/onboarding-derive';
