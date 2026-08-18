import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Define protected routes that require authentication
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/scheduler(.*)",
  "/handover(.*)",
  "/nurses(.*)",
  "/settings(.*)",
  "/ambient(.*)",
  "/burnout(.*)",
  "/learning(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    const { userId } = await auth();

    // If not authenticated, redirect to home page (which has sign-in)
    if (!userId) {
      const homeUrl = new URL("/", req.url);
      return NextResponse.redirect(homeUrl);
    }
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
