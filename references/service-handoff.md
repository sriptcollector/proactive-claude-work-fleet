# Signups and purchases: one tap from the user

The user wants services set up and bought with as little of their time as possible. Agents can't create accounts, sign in with a password or OAuth for a new account, or enter card details. So the agent does everything around the one step only the user can do.

## Signup handoff

1. **Research.** The agent picks the plan that fits: what it costs, its limits, its worst-case cost, and any cheaper option that does the job.
2. **Check the vault.** Search `Accounts/` and `Accounts/Services/`. If an account exists, reuse it and stop here. Tell the boss what was reused.
3. **Open the signup page** in the user's own browser, on the exact plan if the site allows. Close any other tab the agent opened.
4. **The boss asks for one tap**, with the question tool:
   - Question: `<Service> for <project>: <plan>, <price>. <Why this one, in one line>. The signup page is open.`
   - `Make the account, then say done (Recommended)`
   - `Use a different plan or service`
   - `Skip for now`
5. **The user makes the account** and says done. The user handles password, OAuth consent, 2FA and card entry. Nothing else is asked of them.
6. **The agent does all the remaining setup** in the signed-in browser session: settings, project, domains to verify, webhooks, team defaults. Hard limits still apply here. DNS changes, plan upgrades, sends and public posts each need their own approval.
7. **Record it in Bedrock**, in `Accounts/` or `Accounts/Services/`:

   ```markdown
   ---
   login: <the email or username used>
   auth: google | email-code | password | github | sso
   password_location: <where the user keeps it, never the password>
   twofa: <where the codes come from, never a code>
   plan: <plan and price>
   used_by: <project>
   ---
   ```

8. **API keys:** if the setup needs one, make one per project and send it straight into the user's secret store. Never print it, or put it in a note, chat message, command line, log or git. If there's no way to do that without the value passing through the agent, leave the key page open and ask the user, with the question tool, to put it in the store and say done.
9. **Close the tabs** the agent opened, and report what's set up and what wasn't tested.

Keep the signed-in work in the one session that holds the browser. Other sessions get the result, not the login.

## Purchases

Only with a card already on file with that service, and only after the boss has confirmed **the item and the total** with the user.

1. The agent gets the real total from the checkout page, including tax, renewal price and billing period. It stops before paying.
2. The boss asks with the question tool. The approving option names the item, the total and the renewal, like `Buy <item>: <total> now, then <renewal> (Recommended)`. Other options: a cheaper choice if there is one, and `Don't buy`.
3. The session the user answered completes the purchase. If the total differs in any way from what was approved, stop and ask again.
4. Record the plan and price in the account note, and the spend in the project note or experiment.

No card on file: use the signup handoff, and the user enters it on the service's own page.

**Never ask for card numbers in chat.** If the user pastes one, don't repeat it or store it, tell them it's in the chat history, and point them to the service's own billing page.
