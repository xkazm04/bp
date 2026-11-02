// Where the /projects page sends a person: the onboarding screen (the build-up, `/projects/<slug>/onboarding`, optional
// `?job=<id>`) and the product's blueprint (`/?product=<slug>`).
export const onboardingHref = (slug: string, job?: string): string =>
  '/projects/' + encodeURIComponent(slug) + '/onboarding' + (job ? '?job=' + encodeURIComponent(job) : '');
export const blueprintHref = (slug: string | null): string => (slug ? '/?product=' + encodeURIComponent(slug) : '/');
