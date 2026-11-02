import type { Metadata } from 'next';
import { ProjectsPage } from '@/projects/ProjectsPage';

export const metadata: Metadata = {
  title: 'bp · projects',
  description: 'The repositories bp can draw: add one and onboard it, rename or move it, follow its onboarding, remove it.',
};

// /projects (`?fixture=1` or `?fixture=empty` fakes the server for screenshots: apps/web/src/projects/api.ts).
export default function Projects() {
  return <ProjectsPage />;
}
