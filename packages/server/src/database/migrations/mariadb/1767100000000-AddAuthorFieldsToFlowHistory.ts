import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddAuthorFieldsToFlowHistory1767100000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const columns: TableColumn[] = []
        if (!(await queryRunner.hasColumn('flow_history', 'commitMessage'))) {
            columns.push(new TableColumn({ name: 'commitMessage', type: 'text', isNullable: true }))
        }
        if (!(await queryRunner.hasColumn('flow_history', 'authorId'))) {
            columns.push(new TableColumn({ name: 'authorId', type: 'text', isNullable: true }))
        }
        if (!(await queryRunner.hasColumn('flow_history', 'authorName'))) {
            columns.push(new TableColumn({ name: 'authorName', type: 'text', isNullable: true }))
        }
        if (columns.length) await queryRunner.addColumns('flow_history', columns)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('flow_history', 'commitMessage')
        await queryRunner.dropColumn('flow_history', 'authorId')
        await queryRunner.dropColumn('flow_history', 'authorName')
    }
}
