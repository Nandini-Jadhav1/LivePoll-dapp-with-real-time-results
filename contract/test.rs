#![cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Env, Address, String};
use super::{PollContract, PollContractClient};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, PollContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id     = env.register(PollContract, ());
    let client = PollContractClient::new(&env, &id);
    (env, client)
}

fn init_starvote(env: &Env, client: &PollContractClient) {
    client.initialize(
        &String::from_str(env, "What should the Stellar community prioritize in 2025?"),
        &vec![
            env,
            String::from_str(env, "DeFi & DEX improvements"),
            String::from_str(env, "Cross-chain bridges"),
            String::from_str(env, "Mobile wallet UX"),
            String::from_str(env, "Developer tooling"),
        ],
    );
}

// ── Test 1: Vote lands on correct option ──────────────────────────────────────
#[test]
fn test_vote_increments_correct_option() {
    let (env, client) = setup();
    init_starvote(&env, &client);

    let alice = Address::generate(&env);
    let bob   = Address::generate(&env);

    client.vote(&0, &alice); // DeFi
    client.vote(&2, &bob);   // Mobile wallet UX

    let results = client.get_results();
    assert_eq!(results.get(0).unwrap(), 1, "DeFi should have 1 vote");
    assert_eq!(results.get(1).unwrap(), 0, "Cross-chain should have 0 votes");
    assert_eq!(results.get(2).unwrap(), 1, "Mobile UX should have 1 vote");
    assert_eq!(results.get(3).unwrap(), 0, "Dev tooling should have 0 votes");
}

// ── Test 2: Same address cannot vote twice ────────────────────────────────────
#[test]
#[should_panic]
fn test_double_vote_rejected() {
    let (env, client) = setup();
    init_starvote(&env, &client);

    let alice = Address::generate(&env);
    client.vote(&0, &alice);
    client.vote(&1, &alice); // must panic with AlreadyVoted
}

// ── Test 3: Out-of-range option is rejected ───────────────────────────────────
#[test]
#[should_panic]
fn test_invalid_option_rejected() {
    let (env, client) = setup();
    init_starvote(&env, &client);

    let carol = Address::generate(&env);
    client.vote(&99, &carol); // must panic with InvalidOption
}

// ── Test 4: has_voted tracks state correctly ──────────────────────────────────
#[test]
fn test_has_voted_tracking() {
    let (env, client) = setup();
    init_starvote(&env, &client);

    let dave = Address::generate(&env);
    assert!(!client.has_voted(&dave), "should not have voted yet");
    client.vote(&1, &dave);
    assert!(client.has_voted(&dave), "should be marked as voted");
}

// ── Test 5: Poll metadata stored correctly ────────────────────────────────────
#[test]
fn test_poll_metadata_stored_correctly() {
    let (env, client) = setup();
    let question = String::from_str(&env, "What should the Stellar community prioritize in 2025?");
    let options = vec![
        &env,
        String::from_str(&env, "DeFi & DEX improvements"),
        String::from_str(&env, "Cross-chain bridges"),
        String::from_str(&env, "Mobile wallet UX"),
        String::from_str(&env, "Developer tooling"),
    ];
    client.initialize(&question, &options);

    assert_eq!(client.get_question(), question);
    assert_eq!(client.get_options().len(), 4);
}

// ── Test 6: Cannot initialize twice ──────────────────────────────────────────
#[test]
#[should_panic]
fn test_double_init_rejected() {
    let (env, client) = setup();
    init_starvote(&env, &client);
    init_starvote(&env, &client); // must panic with AlreadyInit
}

// ── Test 7: Multiple voters accumulate correctly ──────────────────────────────
#[test]
fn test_votes_accumulate_correctly() {
    let (env, client) = setup();
    init_starvote(&env, &client);

    // 5 voters for option 0, 3 for option 1
    for _ in 0..5 { client.vote(&0, &Address::generate(&env)); }
    for _ in 0..3 { client.vote(&1, &Address::generate(&env)); }

    let results = client.get_results();
    assert_eq!(results.get(0).unwrap(), 5);
    assert_eq!(results.get(1).unwrap(), 3);
    assert_eq!(results.get(2).unwrap(), 0);
}
