## Git 
- Use `gh` cli to interact with github when the user mentions "issues" or "prs" or anything involving github.

## C++ Compilation on Windows
If in the `/mnt/c/` directory or any of its subdirectories, use MSBuild.exe to build c++ projects.
The path is `/mnt/c/Program Files/Microsoft Visual Studio/18/Professional/MSBuild/Current/Bin/amd64/MSBuild.exe`

## Todos/Tasks
Make sure that when doing any work, plan it out first and enter in tasks/todo items in the included task extension.

## Questions
Whenever asking questions, always use the ask_user_question tool, and set the highest timeout possible in order to give the user time to answer.

When the user asks a question, answer it. Change code only when the user asks for a change.

## Fabric Exec
Pass long or multi-line shell text through top-level `payloads` and read it back as `π.key` in `code`. Inline copies of that text break the code parser.

## Searching
Prefer `rg` over `grep`.
Prefer `fd` over `find`.
Do not run fd or find in the root (`/`) directory, it will time out.


## Communication
When answering the user, asking the user a question, etc., use simplified english.
