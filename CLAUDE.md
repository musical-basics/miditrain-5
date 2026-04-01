1. Use pnpm instead of npm in all relevant situations (unless pnpm is not available)

2. NEVER run any migrations into the database (supabase) directly. Always provide the necessary SQL query and let the user run them manually.

3. For supabase or databases, always use server-side actions (service role key) rather than browser-side actions (anon key). Only use anon key if server-side action isn't available.

4. Push after you finish every minor change, unless there is a specific issue that needs to be discussed. If it's a major change, if the implementation was straightforward and met all the user's request, then push. If it wasn't straightforward and final implementation differed from user's original expectation, ask for verification. If the user asked you to revert to a previous git commit, don't just push right away. Let the user have time to review whether which commit they want to continue forward with.

5. Kill your own localhost processes after you run pnpm dev (to verify things work). Let the user run their own localhost servers directly from the terminal. 

6. If it takes more than 2 tries to fix a bug that the user flags, insert verbose logging at every step that can help diagnose the issue. Do NOT remove the logging until the user confirms the bug has been fixed.

7. If my instructions include complete file contents or drop-in replacements, do not blindly overwrite the local files. Treat my provided code as a diff. The local file may contain recent features or state updates not reflected in my provided code. Intelligently merge the logic: retain existing local features while integrating the new changes from my provided code. Flag potential merge conflicts or significant discrepancies before proceeding.

8. When asked to do a repomix, always first scan the repo to see if there are any unnecessary, backup, temp, library modules, or UI elements that aren't needed for the critical functionality of the app, so we reduce the repomix file as much as possible. Generate a repomix.config file that can be reused going forward if one does not exist. Always create .xml file. When asked to do a repomix, DO NOT COMMIT, DO NOT PUSH. Instead, add repomix files to gitignore. 

9. For gitignore, make sure to exclude any **repomix** files, but include the repomix-config file.  

10. If a bug takes more than 2 tries to fix, and we end up fixing it, please document this bug, the cause, the failed fixes that we tried, and the final solution and why it worked, into a .md file in /docs. If a .md file already exists and documents similar bugs to the one we just fixed, append at the end (NEVER delete previous bug fix notes). Otherwise, create a new file and document. If the user asks you to document a fix, please do so based on this logic. If you already have, tell the user you already documented the fix.

11. For code refactorings or architecture refactorings, backup all files into a _backup_files folder that the user can eventually review and clean up. This serves as an additional layer of version control vs. git versioning (to handle messy refactorings where we need to mix and match code from more than 1 git commit)

12. When making a state-level or copy change (e.g., "sold out", "price change", "rebrand"), proactively search the entire codebase for all dependent copy, CTAs, modals, banners, and subtext that reference the old state. Present a list of every affected file with suggested updates BEFORE implementing, so I can approve or decline each one.

13. When adding built-in AI functionality to an app, never just cite model names - instead ping the servers of the respective AI company (Anthropic, Google, etc) and figure out which models are available, then show them in a dropdown to the user to select (especially the latest ones). Because models get outdated all the time. 

14. After making a successful change or fix and pushing to git - suggest 3 improvements to the user and ask them which one they want to tackle next. 

15. When making fixes for handling edge cases, avoid "if/else" statements. Instead, consider the architecture and why the edge case is not being handled. Propose new architectural fixes that encompass the erroneous edge case, rather than handling edge cases with "if/else" statements. 

16. Whenever prompted for an upgrade to the existing feature, don't just change the existing feature. Instead create the new "upgraded version" as a selectable option in the dropdown, so the user can A/B test. Because otherwise you might overwrite important logic in the new feature. 