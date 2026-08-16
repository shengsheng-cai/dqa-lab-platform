"""共用 SQLite fixture 的連線與隔離保證。"""

from sqlalchemy import text


def test_memory_db_uses_distinct_connections_with_shared_schema(patched_session):
    with patched_session() as Session:
        with Session() as first, Session() as second:
            first_connection = first.connection()
            second_connection = second.connection()

            assert (
                first_connection.connection.driver_connection
                is not second_connection.connection.driver_connection
            )

            first.execute(text("CREATE TABLE connection_probe (id INTEGER)"))
            first.commit()
            assert second.execute(text(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'table' AND name = 'connection_probe'"
            )).scalar_one() == "connection_probe"


def test_memory_db_isolates_simultaneous_fixture_contexts(patched_session):
    with patched_session() as FirstSession:
        with FirstSession() as db:
            db.execute(text("CREATE TABLE fixture_probe (id INTEGER)"))
            db.commit()

        with patched_session() as SecondSession:
            with SecondSession() as db:
                assert db.execute(text(
                    "SELECT name FROM sqlite_master "
                    "WHERE type = 'table' AND name = 'fixture_probe'"
                )).scalar_one_or_none() is None
